# 判定エンジンと推薦ポリシー

## 1. 入力と責務

エンジンへ渡す前に、コードが定義参照、期間内集計、製品コンテキスト、候補の有効性を確定する。エンジンは候補ごとの関連性を採点し、共通ポリシーが推薦するか見送るかを決める。

```text
Snapshotを検証
  → 信頼できる辞書を参照
  → source=directの観測に限定
  → 候補・入力容量・最低観測量を検査
  → Rules または Jevが採点
  → 出力検証
  → 閾値・差・抑制条件を適用
  → Decision
```

単純な計数、辞書検索、時間比較をAIに任せない。モデル向け入力は観測の説明文、数値集計、コードで計算した補助フラグ、説明付き候補とする。トピックの辞書だけを見せて、IDの結合をモデルにさせない。

## 2. Adapterの境界

概念上のインターフェースは以下。正式な型名は実装で調整できるが、責務・出力の意味は維持する。

```ts
interface DecisionEngine {
  readonly name: 'rules' | 'jev';
  readonly version: string;
  evaluate(
    input: ResolvedEvaluationInput,
    options: { signal: AbortSignal }
  ): Promise<{
    assessments: CandidateAssessment[];
    model?: string;
  }>;
}
```

ResolvedEvaluationInputは検証済み定義からコードで構築する。HTTPの任意オブジェクトをそのまま渡さない。BrowserのRemoteEngineはこのサーバー内Adapterとは別で、HTTPのDecisionを受け取るtransportである。

CoreのRulesEngineはブラウザでもサーバーでも実行可能。JevEngineはserverのみ。v0.1では自由な型付き質問DSLは作らず、この候補採点を標準の判断タスクにする。独自用途ではsnapshot購読を利用できる。

## 3. 全エンジン共通の事前条件

初期の最低観測量は、directのqualifiedViews合計2以上、またはdirectのclicks+actions合計1以上。満たさなければ `insufficient_evidence`。これは購入意思の検出基準ではなく、少なすぎる観測で案内しないための仮のゲートである。

coverage.truncated=trueは `capacity_limit`。入力が欠けた状態で自信がある判定を出さない。

候補から、enabled=false、期間外、現在のpageIdに紐づくcontentId、期間内にdismissed/completedされたcontentIdを除外する。候補のcontentIdに紐づいたcontentシグナルが既にqualified viewを持つ場合も、同じ内容の再案内を避けるため除外する。

ページにproductIdがある場合、別製品の候補は除外する。productIdを持たない候補は共通コンテンツとして許可する。別製品の観測をそのまま現在の製品への強い関心に加算しない。

直近60秒にいずれかの案内がshownなら `suppressed`。shownを記録するのは実際にUIが表示した時だけ。判定を生成しただけでは表示済みにしない。

候補がなくなれば `no_eligible_content`。初期の評価候補数は最大8、設定上限20。超える場合は初期化時に警告し、実行時には `capacity_limit` とする。暗黙の上位8件切り捨てはしない。サイトごとの候補集合を小さくすることで対応する。

## 4. RulesEngineの初期アルゴリズム

目的は、無料で試せる比較対象と、同じ入力から同じ結果を返す基準を作ること。自然文の意味理解は行わない。

source=directの各観測sについて次を計算する。

```text
base(s) = clamp(
  0.2 * min(qualifiedViews, 2)
  + 0.3 * min(visibleMs / 30000, 1)
  + 0.6 * min(clicks + actions, 1),
  0, 1
)

recency(s) = 2 ^ (-lastSeenAgoMs / 300000)
evidence(s) = base(s) * recency(s)
```

候補cとの対応度affinityは、sとcのproductIdが両方設定され異なる場合は0。それ以外で、relatedSignalIdsがsを含めば1、topicIdsが1件以上共通なら0.5、いずれもなければ0。複数条件を足して増幅しない。

```text
score(c) = max_s(evidence(s) * affinity(s, c))
```

空集合なら0。多数のタグを付けたことでスコアが上がらないよう合計ではなくmaxとする。結果のscoreKindはheuristic、providerConfidenceは省略する。

推薦の初期閾値は最高scoreが0.35以上、2位との差が0.10以上。候補が1件なら差の条件は不要。閾値未満はbelow_threshold、僅差や同点はambiguous。候補順はcontentIdで安定化するが、同点を辞書順だけで勝者にしない。

上記の係数は `rules-v1` としてバージョン管理する、未検証の初期値。ユーザーの心理やCV率を表すものではなく、変更時は合成データで再比較する。

## 5. JevEngine

### 問いの設計

候補ごとに独立したScoreを作り、同じstateに対して1リクエストで評価する。関心分類の出力を別の質問が同一リクエスト内で参照できる前提にしない。[公式仕様 S1・S2](08-references-and-decisions.md#s1)

問いの意味は「この候補は、今回の直接の行動記録を踏まえ、追加情報としてどの程度関連するか」に限定する。購入確率・人物属性・CVの最大化を直接推定させない。

初期ルーブリックは4段階。

| 段階 | 判定基準 |
| --- | --- |
| 0 | 観測した内容との関連を示す材料がない、または無関係 |
| 1 | 同じ製品の一般情報だが、現在の関心を示す行動との結び付きは弱い |
| 2 | 直接の閲覧・操作が示すテーマに関連する追加情報 |
| 3 | 直近の具体的なテーマをさらに説明し、複数の観測または明示的操作から適合を支持できる |

0は「人が興味を持っていない」ではなく「今回の入力から関連を支持できない」。表示時間だけで読了・好意を断定せず、未観測を否定的証拠にしないことをinstructionsに明記する。

英語の質問・基準を標準候補にし、辞書のmodelDescriptionを優先する。未指定ならdescriptionをそのまま使い、日本語版との比較で検証する。日本語と英語の品質が同等とは仮定しない。[モデル資料 S4](08-references-and-decisions.md#s4)

### SDKと接続

公式JavaScript SDKは `@typesafe-ai/sdk`。確認時点の入口はTypeSafeClientとsystemOne。実装時には公式SDKの現在の型・モデル一覧を再確認して依存バージョンをlockfileへ固定する。過去の会話に出た仮のAPIを実在するとみなさない。[SDK資料 S5](08-references-and-decisions.md#s5)

APIキーはサーバー環境変数TYPESAFE_API_KEY。モデルはサーバー設定で明示する。2026-09-26確認時の資料にはjev-1.13.0が掲載されているが、実装時に利用可能性を確認する。評価に使うモデルは可変エイリアスではなくバージョンを固定し、応答に含まれる実際のmodelも記録する。

SDKのデフォルト再試行に任せない。v0.1はプロバイダーへの自動再試行なし。SDKの現行RetryPolicyで無効にする正しい設定を型とテストで確認する。timeoutは初期2,000ms、HTTP transportの全体上限は3,000ms。中断しても既に処理済みの課金が取り消される保証はない。

秘密キー、入力本文、SDKのdebugログをブラウザや通常ログに出さない。モデル接続先のbase URLを公開リクエストから指定させない。

### スコアの解釈

Scoreは段階ごとの確率で重み付けした期待値で、4段階なら0〜3の小数を含む値となる。整数には制限しない。`score = rawScore / 3` として順位付け用に正規化し、rawScoreも保持する。人物の関心や購入の確率に変換したわけではない。[S2](08-references-and-decisions.md#s2)

Jevのconfidenceは確率分布由来の指標であり、正答率の保証ではない。Rulesへ同じ意味のconfidenceを付けない。[S3](08-references-and-decisions.md#s3)

初期の出力ゲートは正規化score>=0.65、最高候補のproviderConfidence>=0.60、2位との差>=0.10。単独候補なら差の条件は不要。どれも実測で最適化する前の保守的な仮設定である。実際の評価で全く案内されない・誤案内が多い等があれば、検証データとともにpolicyVersionを更新する。

全候補の評価が揃っていること、score/原値/confidenceの範囲、contentIdの整合性を検証する。不正応答はinvalid_result。閾値不足を「AIが不具合」として別の回答が出るまで繰り返さない。

### 型が合っていても意味は間違い得る

型付き出力であることと、推薦の正しさは別。辞書の誤り、弱い観測、モデルの取り違え、敵対的テキストの影響を評価する。自由生成しないことを理由に誤判断やprompt injectionがないとは主張しない。[S8](08-references-and-decisions.md#s8)

## 6. 障害と出力の鮮度

認証失敗、timeout、429、5xx、ネットワーク遮断はengine_unavailableとして見送り、通常CTAを維持する。無断で別の有料モデルへ切り替えない。v0.1のリモート失敗時は自動Rulesフォールバックもしない。Rulesを使う場合は利用側がモードを明示する。

maxAgeMsの初期値は30,000ms。ただし同意撤回、ページ変更、新しいrevision、候補無効化、dismissed/completedがあれば30秒以内でも失効する。UIが表示を遅らせた場合にも再検証する。

失効・不正定義・同意なしのときに、以前の成功した推薦を再利用しない。

## 7. 評価の方法

同じ合成Snapshotと同じ候補集合に対し、Rules、ラベル中心のJev、説明付き辞書のJevを比較する。日本語/英語の比較はさらに別軸として行う。

正解は単一の「人の本心」ではなく、レビュー済みの許容contentId集合またはabstainとする。推薦一致率だけでなく、案内すべきでないケースの誤案内、見送り率、遅延、入力サイズ、利用量を記録する。

promptを調整する用のデータと、最終比較用のholdoutを分ける。説明を増やしてconfidenceが上がっただけでは精度改善と結論しない。本番のCV効果は別の実験課題で、v0.1のオフライン評価では証明しない。
