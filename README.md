# imicue
An open-source library that turns website and app behavior signals into meaningful decisions and recommendations.

登録した行動シグナルに辞書で意味を付け、次に案内する候補を評価する、UIを持たないライブラリです。M0〜M4を実装し、ローカルの配布ファイルとNext.jsの静的デモまで確認しています。Jev実APIのシナリオ比較と3ブラウザからの接続も実施しました。[実測結果と制約](docs/15-freshness-and-live-browser.md)を参照してください。表示時間は読了時間ではなく、Rulesのスコアも購入確率ではありません。

## ローカルデモを動かす

Node.js **24.14.0** と npm **11.9.0** を使います。nvmを使う場合は、最初に `nvm install && nvm use` を実行してください。

```sh
npm ci
npm run dev
```

[ローカルデモ](http://127.0.0.1:5183/)を開き、計測の許可にチェックを入れて「計測を開始」を押します。架空製品DemoContractの機能・料金・事例を表示したり、検索例を操作したりすると、画面内で集計、辞書の意味、採点、見送り理由を確認できます。判定の開始間隔は最低15秒です。

デモの同意操作はSDKの動作確認用です。停止は直近の記録を維持し、同意撤回とリセットは記録と抑制履歴を削除します。リセット後は、計測中なら新しい記録を始めます。既定の保存先はメモリで、ページを読み直すと消えます。外部AIへの判定通信やAPIキーは必要ありません。

静的ビルドもローカルで試せます。

```sh
npm run build
npm run preview
```

[静的ビルドのデモ](http://127.0.0.1:4173/)は `dist/demo` を配信します。通常のガイドへのリンクは、計測を許可しなくても使えます。

## 公開用サイトのローカル版

```sh
npm run dev:site
```

[紹介サイト](http://127.0.0.1:5187/)で、仕組み・合成記録によるRulesデモ・導入手順・制約を確認できます。このページは閲覧履歴を収集せず、実APIも呼びません。静的ファイルを作る場合は `npm run build:site`、その確認には `npm run preview:site` を使います。出力先は `dist/site` です。まだデプロイしていません。[公開用サイトと運用案](docs/19-public-site-and-operations.md)を参照してください。

## ページ移動後の記録を試す

[ページ横断のデモ](http://127.0.0.1:5183/?storage=session)を開きます。通常モードの確認パネル末尾にも切り替えリンクがあります。

1. 計測を許可して開始し、「検索例を開く」を押します。
2. 「機能ガイド」に移動します。この時点では記録を読み込んでいません。
3. 移動先でも許可・開始すると、前のページの操作を復元します。「このガイドの確認を完了」を押します。
4. トップへ戻り、再び許可・開始します。確認パネル末尾の「記録がある項目」と集計を確認してください。完了した機能ガイドは推薦候補から外れます。
5. 「同意を撤回」を押すと保存分も削除します。再読み込み後に許可・開始しても、撤回前の記録は戻りません。

同じサイト・同じタブの直近30分が対象です。ブラウザで保存が利用できない場合は、そのページ内のメモリだけで計測し、画面に制約を表示します。同意は保存しません。ブラウザの「戻る」でページがキャッシュから復帰した場合も、最新の保存記録を扱うため再読み込みし、許可・開始を待ちます。

通常モードへ切り替えるだけでは保存分を削除しないため、消す場合は先に同意を撤回してください。モック接続と組み合わせる場合は `?engine=remote&storage=session` を指定し、別ターミナルで `npm run dev:server` を起動します。

## SDKの最小例

以下はこのworkspaces内で使う例です。パッケージは未公開です。通常のimportは `npm run build:packages` で生成したESMと型定義を使います。`definition` は [データ契約](docs/02-data-contracts.md) に従う固定の辞書です。

```js
import { createTracker } from '@imicue/browser';
import { createRulesEngine } from '@imicue/core';
import { definition } from './definition.js';

const tracker = createTracker({
  definition,
  pageId: 'home',
  engine: createRulesEngine(),
  storage: 'memory', // 'session' を明示した場合だけsessionStorageを使用
});

const unsubscribe = tracker.onDecision((decision) => {
  if (decision.type === 'recommend' && tracker.canDisplay(decision)) {
    // contentsから候補を解決し、利用サイト側で表示する。
    // 実際に表示したときだけrecordOutcome(contentId, 'shown')を呼ぶ。
  }
});

// 利用サイトの同意管理から明示的な許可を受けた後に呼ぶ。
tracker.setConsent('granted');
tracker.start();
tracker.track('demo-feature-used', { source: 'direct' });

// ページやコンポーネントを破棄するとき。
unsubscribe();
tracker.destroy();
```

`data-imicue-signal` は登録したcontentシグナルだけを計測します。手動 `track()` はactionシグナルだけを受け付け、任意のmetadataや入力テキストは受け付けません。`data-imicue-ignore` で対象外にし、`data-imicue-source="recommendation"` で推薦由来の記録を分離できます。

ページをまたいで直近30分の記録を使う場合、SPAでは同じTrackerを維持して `setPage(pageId)` を呼びます。通常のリンク遷移や再読み込みにも対応する場合は、各ページで同じ辞書を使い `storage: 'session'` を指定します。同一Origin・同じタブのsessionStorageから、許可とstartの後に記録を復元します。同意自体は保存しないため、利用サイトの同意管理との接続が必要です。同意撤回・リセットでは保存分も削除します。別ドメインや別端末をまたぐユーザー識別は行いません。

Vanillaデモは既定のmemory設定では通常のページ遷移で記録が消えます。`?storage=session` を付けると、通常のページ移動後も記録を復元するモードになります。Next.jsデモはLink遷移中の記録を維持しますが、再読み込みでは消えます。表示条件を満たしたガイドや確認完了したガイドは再推薦から除外します。別の候補を案内するには辞書の関連と観測の根拠が必要で、機能ガイドを見たことだけで料金への興味を断定しません。

## M3のモック接続を試す

`npm run dev` を動かしたまま、別のターミナルで判定サーバーを起動します。

```sh
npm run dev:server
```

[サーバー接続デモ](http://127.0.0.1:5183/?engine=remote)を開き、許可して計測を開始し、「検索例を開く」を操作します。判定の詳細に `mock-local-v1`、スコアに「モック」と表示されます。通常のガイドも利用できます。

サーバーは `127.0.0.1:5193` で待ち受けます。このコマンドはAPIキーが環境に存在してもモックを使い、外部APIを呼びません。モックのスコアとconfidenceは通信確認用の合成値です。Jevの判断品質を再現するものではありません。URLの `?engine=remote` を外すとローカルRulesに戻ります。

SDKで接続する場合は、上の `engine` を次の設定に置き換えます。

```js
import { createRemoteEngine } from '@imicue/browser';

const engine = createRemoteEngine({
  endpoint: 'http://127.0.0.1:5193/v1/decide',
  allowedOrigins: ['http://127.0.0.1:5193'],
});
```

同一Originなら相対パスの `endpoint: '/v1/decide'` を使えます。localhost以外はHTTPSが必要です。送信はSnapshotのみで、辞書・プロンプト・APIキーをブラウザから渡しません。通信失敗時は見送り、Rulesへ自動で切り替えません。

400・409・413を受け取ると、そのRemoteEngineは再送を止めます。辞書や設定を修正してからインスタンスを作り直してください。429では `Retry-After` に従って待機し、その後の判定要求で再開します。

## Jev実API試験は許可後に別コマンドで行う

実APIを使うには、実行の許可とローカル環境変数 `TYPESAFE_API_KEY` の設定が必要です。キーをチャットやGitへ貼らず、サーバー側だけで扱ってください。次のコマンドは有料APIを呼び得ます。

```sh
RUN_JEV_INTEGRATION=1 JEV_INTEGRATION_REQUESTS=1 npm run test:jev
```

合成データのみで1回実行します。回数は1〜5に制限し、再試行は行いません。フラグやキーがない場合はSKIPを表示します。継続してデモを実APIへ接続する場合も別途許可が必要で、`RUN_JEV_SERVER=1 npm run dev:server:jev` を明示して起動します。

Rulesと辞書付きJevを12シナリオで比較する場合は、Git管理外の `.env.local` にキーを設定して、次を実行します。

```sh
RUN_JEV_EVALUATION=1 node --env-file=.env.local --import tsx --conditions=imicue-source scripts/evaluate-jev.ts
```

最大12リクエスト、再試行なし。現在のシナリオでは4件をAPI呼び出し前に見送るため、実API呼び出しは8回です。通信・応答検証の失敗で打ち切ります。結果はGit管理外の `test-results/jev-regression-evaluation.json` と日時付きファイルに保存し、キー・ヘッダー・生の応答本文は残しません。人の意味評価は未実施で、期待値との一致数は推薦精度を表しません。

同名の候補、複数の関心、関連候補がない場合などを試すには、上のコマンドに `JEV_EVALUATION_SUITE=semantic` を追加します。こちらは12件で最大12回のAPI呼び出しです。[推薦内容の確認表](docs/17-recommendation-review.md)と[単発操作に対応する採点基準の実測](docs/18-jev-relevance-rubric.md)に、各場面の許容案と結果をまとめています。

Jevの推薦根拠は直近5分に最終観測されたシグナルへ限定しました。記録と既読・完了による除外は30分保持します。[追加7シナリオと実ブラウザ接続の検証手順・結果](docs/15-freshness-and-live-browser.md)を参照してください。サーバーとブラウザは同じバージョンへ更新する必要があります。古い判定ポリシーの応答は受け入れません。

現在の判定ポリシーは `jev-rubric-v3`。内容が明確に一致する明示操作なら、1回でも関連ガイドを案内できる採点基準です。曖昧な操作、無関係な候補、候補差が小さい場合は見送ります。説明を省いたラベル中心の入力では誤案内も観測したため、具体的な辞書説明を用意してください。

## M4の配布ファイルとNext.jsデモを試す

まず `npm run build` でパッケージ、単体ブラウザファイル、Vanillaデモ、Next.jsの静的出力を生成します。

```sh
npm run build
npm run preview:next
```

[Next.js静的デモ](http://127.0.0.1:5184/)で計測を許可・開始し、「検索例を開く」を操作します。上部のガイド間を移動するとpageIdとpageViewIdが変わり、記録と許可は維持されます。再読み込みではリセットされます。候補のリンクは「候補のガイドを表示」を押すと現れます。

初期モードはRulesで、判定サーバーは不要です。「判定サーバー接続」を選ぶ場合だけ、別ターミナルで `npm run dev:server` を起動してください。モード変更時は許可と記録をリセットします。Next.js内には判定用のPOST APIを置いていません。

配布形式を比べる場合は、次のサーバーを別ターミナルで起動します。

```sh
npm run preview:distribution
```

[ESMデモ](http://127.0.0.1:5185/es/)と[IIFEデモ](http://127.0.0.1:5185/iife/)は、生成した固定ファイルを読み込みます。IIFEは `window.Imicue` に `createTracker`・`createRulesEngine`・`createRemoteEngine`・`version` を公開します。読み込みだけでは計測を始めません。既存の `window.Imicue` は上書きせず、重複読み込みは `imicue:global_conflict` で知らせます。

| 生成先 | 内容 |
| --- | --- |
| `packages/core/dist`・`packages/browser/dist`・`packages/server/dist` | ESM、`.d.ts`、LICENSE |
| `dist/browser/imicue-0.1.0-dev.0.js` | CoreとRulesを含む単体ESM |
| `dist/browser/imicue-0.1.0-dev.0.iife.js` | 通常のscriptタグ用ファイル |
| `dist/browser/manifest.json` | バージョン、サイズ、SHA-384のSRI値 |
| `examples/next-static/out` | Next.jsが出力したHTML・JS・CSS |

すべてローカル成果物です。npmやCDNには公開していません。IIFEの自己配信例、CSP、型定義の扱いは [M4の実装メモ](docs/11-distribution-and-next.md) に記載しています。Next.jsの開発モードが必要な場合は `npm run dev:next` を使います。確認用の静的配信は5184、開発モードは5186です。

## 検証を実行する

```sh
npx playwright install chromium firefox webkit
npm run check
```

`check` は型検査、lint、単体・統合テスト、ビルド、配布ファイルとnpm梱包予定の検査、12シナリオのRules評価、Chromium・Firefox・WebKitでのE2Eを順に実行します。個別には `npm run typecheck`、`npm run lint`、`npm test`、`npm run check:bundle`、`npm run check:distribution`、`npm run test:e2e`、`npm run test:site` を使います。配布検査とE2Eの前には `npm run build` が必要です。E2Eは4173・4187・5184・5185・5193を使うため、同じポートを使うこのリポジトリの手動プレビューは先に停止してください。通常テストから実APIは呼びません。

macOSでPlaywright同梱のFirefoxとWebKitを検証しています。別途、[Safari 26.4製品版でVanillaデモの計測・ページ横断・実Jev接続](docs/16-safari-verification.md)を確認しました。Safari向け試験は `npm run test:safari` で再現できます。WebDriverには「リモートオートメーションを許可」の事前設定が必要です。iPhone/iPadの実機検証は残っています。

## 実装範囲と制約

Coreに辞書検証・期間限定集計・Rules・共通ポリシー、Browserに同意・属性計測・保存・購読・判定スケジューラー・HTTP通信を実装しています。Serverは固定辞書を解決し、入力と利用枠を検査してJev Adapterへ渡します。CoreはDOMやJev SDKに依存しません。公開APIと詳しい設計は [仕様書一覧](docs/README.md)、検証結果は [M0〜M2](docs/09-local-implementation.md)、[M3](docs/10-server-implementation.md)、[M4](docs/11-distribution-and-next.md) を参照してください。

M5の利用手順・貢献ガイド・評価レポート・梱包検査を追加しました。[公開前の残る確認](docs/12-release-preparation.md)と[貢献ガイド](CONTRIBUTING.md)を参照してください。リリース承認は未実施です。npm公開・デプロイ・実サイト導入は行っていません。メモリ内の利用制限は開発用で、本番モードでは共有カウンターを持つ制限フックがないと起動を拒否します。共有基盤は未実装です。

通常の同一documentのDOMが対象です。iframe、Shadow DOM、特殊なCSS transformや重なりの完全な判定には対応しません。60秒無操作で表示時間の計測を止めるため、操作せず長文を読む時間も停止対象です。推薦品質やCV改善、未検証のブラウザ・OSでの互換性は、このローカル試験からは保証しません。
