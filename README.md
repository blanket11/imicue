# imicue
An open-source library that turns website and app behavior signals into meaningful decisions and recommendations.

登録した行動シグナルに辞書で意味を付け、次に案内する候補を評価する、UIを持たないライブラリです。M0〜M2のローカル版とM3の判定サーバーを実装しています。M3はモックで検証し、Jev実API試験は未実施です。表示時間は読了時間ではなく、Rulesのスコアも購入確率ではありません。

## ローカルデモを動かす

Node.js **24.14.0** と npm **11.9.0** を使います。nvmを使う場合は、最初に `nvm install && nvm use` を実行してください。

```sh
npm ci
npm run dev
```

[ローカルデモ](http://127.0.0.1:5183/)を開き、計測の許可にチェックを入れて「計測を開始」を押します。架空製品DemoContractの機能・料金・事例を表示したり、検索例を操作したりすると、画面内で集計、辞書の意味、採点、見送り理由を確認できます。判定の開始間隔は最低15秒です。

デモの同意操作はSDKの動作確認用です。停止は直近の記録を維持し、同意撤回とリセットは記録と抑制履歴を削除します。リセット後は、計測中なら新しい記録を始めます。保存はメモリのみで、ページを読み直すと消えます。外部AIへの判定通信やAPIキーは必要ありません。

静的ビルドもローカルで試せます。

```sh
npm run build
npm run preview
```

[静的ビルドのデモ](http://127.0.0.1:4173/)は `dist/demo` を配信します。通常のガイドへのリンクは、計測を許可しなくても使えます。

## SDKの最小例

以下はこのworkspaces内で使う例です。パッケージは未公開です。`definition` は [データ契約](docs/02-data-contracts.md) に従う固定の辞書です。

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

実APIを使うには、実行の許可とローカル環境変数 `TYPESAFE_API_KEY` の設定が必要です。キーをチャットやGitへ貼らず、サーバー側だけで扱ってください。次のコマンドは有料APIを呼び得るため、今回は実行していません。

```sh
RUN_JEV_INTEGRATION=1 JEV_INTEGRATION_REQUESTS=1 npm run test:jev
```

合成データのみで1回実行します。回数は1〜5に制限し、再試行は行いません。フラグやキーがない場合はSKIPを表示します。継続してデモを実APIへ接続する場合も別途許可が必要で、`RUN_JEV_SERVER=1 npm run dev:server:jev` を明示して起動します。

## 検証を実行する

```sh
npx playwright install chromium
npm run check
```

`check` は型検査、lint、単体テスト、静的ビルド、ブラウザ用コードの依存・サイズ検査、ChromiumでのE2Eを順に実行します。個別には `npm run typecheck`、`npm run lint`、`npm test`、`npm run check:bundle`、`npm run test:e2e` を使います。E2Eの前には `npm run build` が必要です。E2Eは4173と5193を使うため、手動で起動したモックサーバーは先に停止してください。通常テストから実APIは呼びません。

## 実装範囲と制約

Coreに辞書検証・期間限定集計・Rules・共通ポリシー、Browserに同意・属性計測・保存・購読・判定スケジューラー・HTTP通信を実装しています。Serverは固定辞書を解決し、入力と利用枠を検査してJev Adapterへ渡します。CoreはDOMやJev SDKに依存しません。公開APIと詳しい設計は [仕様書一覧](docs/README.md)、検証結果は [M0〜M2](docs/09-local-implementation.md) と [M3の実装メモ](docs/10-server-implementation.md) を参照してください。

配布用ESM/型定義/IIFEとNext.jsの例はM4、公開準備はM5として残しています。npm公開・デプロイ・実サイト導入は行っていません。メモリ内の利用制限は開発用で、本番モードでは共有カウンターを持つ制限フックがないと起動を拒否します。共有基盤は未実装です。

通常の同一documentのDOMが対象です。iframe、Shadow DOM、特殊なCSS transformや重なりの完全な判定には対応しません。60秒無操作で表示時間の計測を止めるため、操作せず長文を読む時間も停止対象です。推薦品質やCV改善、他ブラウザでの互換性は、このローカル試験からは保証しません。
