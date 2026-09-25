# データ契約と意味辞書

状態: v0.1設計仕様。以下のTypeScriptとHTMLは実装するAPIの設計例であり、現在利用できるnpm APIではない。

## 1. 観測ID、意味、推定を分ける

```html
<section data-imicue-signal="demo-pricing">
  <!-- 架空製品の料金案内 -->
</section>
```

属性値は1つの登録済みID。空白区切りの自由キーワードや自然文をそのまま送信しない。section以外の要素にも使える。

`pricing`だけに意味の解釈を任せず、対応する辞書に「どの製品の、何を説明するものか」を記述する。辞書は追加学習ではなく、判定入力を構築するための設定である。

観測対象、判定基準、案内候補は別の定義とする。料金の内容を見た事実に、購入意欲や導入検討中という推定を混ぜない。

## 2. 定義ファイル

```ts
type Id = string;
type Source = 'direct' | 'recommendation';

interface Meaning {
  label?: string;
  description: string;
  modelDescription?: string;
}

interface SignalDefinition extends Meaning {
  kind: 'content' | 'action';
  productId?: Id;
  topicIds?: Id[];
  contentId?: Id;
}

interface ContentDefinition extends Meaning {
  title: string;
  href: string;
  productId?: Id;
  topicIds?: Id[];
  relatedSignalIds?: Id[];
  enabled: boolean;
  availableFrom?: string; // UTC ISO 8601。比較はコードで行う
  availableUntil?: string;
}

interface PageDefinition {
  productId?: Id;
  contentId?: Id;
}

interface Definition {
  schemaVersion: '0.1';
  siteId: Id;
  definitionVersion: string;
  topics?: Record<Id, Meaning>;
  signals: Record<Id, SignalDefinition>;
  contents: Record<Id, ContentDefinition>;
  pages: Record<Id, PageDefinition>;
}
```

`description`は必須。`label`は人向け表示、`modelDescription`は任意のモデル向け説明で、未指定時はdescriptionを使う。日本語と英語は同じ意味になるよう管理者がレビューし、リクエストごとの自動翻訳は行わない。

`productId`は辞書内のグルーピングキーであり、推定された訪問者の属性ではない。トピックが異なる製品間で同じ名前でも、signalIdは区別する。

`relatedSignalIds`はルールエンジンに明示的な対応を教える設定。Jevはこの一致だけに制限せず、説明と行動も評価する。

### 最小の具体例

```ts
const definition = {
  schemaVersion: '0.1',
  siteId: 'demo-contract',
  definitionVersion: 'demo-1',
  topics: {
    pricing: { description: '利用料金や見積もりに関する情報' },
  },
  signals: {
    'demo-pricing': {
      kind: 'content',
      productId: 'demo-contract',
      topicIds: ['pricing'],
      description: '架空製品DemoContractの料金体系と見積もり方法を説明するセクション',
      modelDescription: 'A section explaining DemoContract pricing and how to request a quote.',
    },
    'demo-feature-used': {
      kind: 'action',
      productId: 'demo-contract',
      description: '架空製品の検索機能を利用した操作。検索語そのものは記録しない',
    },
  },
  contents: {
    'demo-pricing-guide': {
      title: '料金の考え方を見る',
      description: 'DemoContractの費用構成についてさらに詳しく説明する架空のガイド',
      modelDescription: 'A detailed guide to the cost structure of DemoContract.',
      href: '/guides/pricing/',
      productId: 'demo-contract',
      topicIds: ['pricing'],
      relatedSignalIds: ['demo-pricing'],
      enabled: true,
    },
  },
  pages: {
    home: { productId: 'demo-contract' },
    'pricing-guide': {
      productId: 'demo-contract',
      contentId: 'demo-pricing-guide',
    },
  },
} satisfies Definition;
```

URL例は架空のデモ用。サーバーにブラウザからhrefを渡して案内先を決めさせない。

### 定義の検証

IDは1〜64文字、`^[a-z0-9][a-z0-9_-]*$` とし、`__proto__`、`prototype`、`constructor`等の危険なキーを拒否する。辞書参照はown propertyのみを対象にし、可能ならMapを使う。

description/modelDescriptionは各1〜1,000文字、label/titleは各1〜120文字。初期上限はsignals 200件、topics 32件、contents 20件、pages 100件。全参照を検証し、未知トピック、未知contentId、未知relatedSignalId、重複した定義、無効な期間を初期化エラーにする。

hrefは同一サイトの `/` から始まる相対パス、または設定で許可したHTTPS originのみ。`//`、`javascript:`、`data:`、資格情報付きURLは拒否する。許可判定はURL parserによるorigin完全一致で行う。ブラウザもレンダリング直前に再検証する。

定義は初期化時に検証して不変にする。ライブの部分書き換えはv0.1では対応しない。差し替え時は新しいdefinitionVersionで再初期化する。

## 3. 観測スナップショット

ブラウザ内部では短いイベント・表示区間を保持し、以下の形式へ集計する。HTTPへ送るものはこれだけで、DOM本文・説明文・生URL・任意metadataは含めない。

```ts
interface SignalObservation {
  signalId: Id;
  source: Source;
  qualifiedViews: number;
  visibleMs: number;
  clicks: number;
  actions: number;
  lastSeenAgoMs: number;
}

interface RecentEvent {
  signalId: Id;
  source: Source;
  kind: 'qualified-view' | 'click' | 'action';
  ageMs: number;
}

interface ContentOutcome {
  contentId: Id;
  kind: 'shown' | 'clicked' | 'dismissed' | 'completed';
  ageMs: number;
}

interface Snapshot {
  schemaVersion: '0.1';
  siteId: Id;
  definitionVersion: string;
  snapshotId: string; // 新しいスナップショットごとのランダムな相関ID
  revision: number;
  pageViewId: string; // ページ表示単位。ユーザーIDではない
  pageId: Id;        // pagesに登録した固定ID。URLから自動生成しない
  windowMs: number;
  observations: SignalObservation[];
  recent: RecentEvent[];
  outcomes: ContentOutcome[];
  coverage: { truncated: boolean };
}
```

数値は有限・非負。カウントとミリ秒は整数。lastSeenAgoMs/ageMsはスナップショット作成時点からの経過時間で、0〜windowMs以内とする。未知フィールドはHTTP境界で拒否する。IDや定義の上限もHTTP受信時に再検証する。

visibleMsは「計測条件を満たして表示されていた時間」であり、読了時間ではない。非閲覧のsignalをゼロ行で埋めない。記録が存在しないことは関心が低いという意味ではない。

sourceごとに別行を持つ。同一signalIdとsourceの重複行は不正入力とする。複数の要素が同時表示されるため、異なるsignalのvisibleMsを足した値がwindowMsを超えることはあり得る。同一signal/sourceのvisibleMsはwindowMsを超えない。

recentは新しい順に最大20件、outcomesは最大100件。保持上限で古い観測を捨てた場合はcoverage.truncatedをtrueにする。正常な時間経過によるウィンドウ外の削除はtruncationとしない。

snapshotIdとpageViewIdは人物識別子ではなく、サーバーで信用できる認証情報にもならない。既存の会員ID、広告ID、メールアドレスを流用しない。

## 4. 辞書の解決

ローカルルールでは検証済みのローカル定義を使う。リモートでは `siteId + definitionVersion` に対応するサーバー管理の辞書を使う。HTTPリクエスト内の辞書・指示・候補定義を受け入れない。

登録済みsignalIdを説明文へ展開し、関連する製品・トピックの意味と行動を並べる。recentのIDもコードで意味へ解決する。候補も説明文付きにする。計数、期間判定、並べ替えはコードで済ませる。

製品ID・トピックIDそのものに十分な意味がない場合、対応するdescription内でも対象を説明する。巨大な辞書を丸ごとモデルへ渡さない。

旧バージョンの静的HTMLは旧辞書を参照する。サーバーに該当バージョンがなければ `definition_mismatch` とし、最新辞書へ勝手に置換しない。対応する旧辞書を保持する期間は利用者のデプロイ方針で決める。

## 5. 評価と出力

```ts
interface CandidateAssessment {
  contentId: Id;
  score: number; // 0〜1の順位付け用値。購入確率や興味の確率ではない
  scoreKind: 'heuristic' | 'rubric';
  rawScore?: { value: number; min: number; max: number };
  providerConfidence?: number; // 提供された場合のみ。Rulesでは省略
}

interface EngineInfo {
  name: 'rules' | 'jev';
  version: string;
  model?: string; // 応答で確認した実際のモデルID
}

type AbstainReason =
  | 'insufficient_evidence'
  | 'no_eligible_content'
  | 'below_threshold'
  | 'ambiguous'
  | 'suppressed'
  | 'capacity_limit'
  | 'definition_mismatch'
  | 'engine_unavailable'
  | 'invalid_result';

interface DecisionBase {
  schemaVersion: '0.1';
  decisionId: string;
  snapshotId: string;
  revision: number;
  pageViewId: string;
  definitionVersion: string;
  policyVersion: string;
  engine: EngineInfo;
  assessments: CandidateAssessment[];
  maxAgeMs: number;
}

type Decision = DecisionBase & (
  | { type: 'recommend'; contentId: Id }
  | { type: 'abstain'; reason: AbstainReason }
);
```

Engineは候補を採点し、共通のポリシーがrecommend/abstainを決定する。生のJevレスポンスを公開APIに漏らさない。候補外ID、欠けた評価、非有限値、範囲外scoreは受け入れない。

confidenceを持たないエンジンに便宜上1.0を付けない。confidenceから「正答率○%」「興味○%」という表示を作らない。

URL、HTML、JavaScriptは返さない。UIは承認済みのローカルcontentsからcontentIdを解決する。観測上の根拠を表示する場合も、入力で使ったシグナルの一覧と、AIの内的な理由を区別する。

同意がない・インスタンスが破棄済みなど、処理が開始できない場合は判定を生成しない。必要な診断はローカルのtyped diagnosticとして通知する。技術的失敗をモデルが「関心なし」と判断した結果に偽装しない。

## 6. バージョンの役割

schemaVersionはwire形式、definitionVersionは辞書、policyVersionは集計・採点・閾値、engine.versionは実装を識別する。モデルIDとは独立させる。

再現テストでは、これらの値と合成スナップショットを固定する。ライブラリバージョンと辞書のバージョンを同一視しない。
