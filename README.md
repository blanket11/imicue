# imicue
An open-source library that turns website and app behavior signals into meaningful decisions and recommendations.

登録した行動シグナルに辞書で意味を付け、次に案内する候補を評価する、UIを持たないライブラリです。M0〜M2のローカル版を実装しています。表示時間は読了時間ではなく、Rulesのスコアも購入確率ではありません。

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

## 検証を実行する

```sh
npx playwright install chromium
npm run check
```

`check` は型検査、lint、単体テスト、静的ビルド、ブラウザ用コードの依存・サイズ検査、ChromiumでのE2Eを順に実行します。個別には `npm run typecheck`、`npm run lint`、`npm test`、`npm run check:bundle`、`npm run test:e2e` を使います。E2Eの前には `npm run build` が必要です。

## 実装範囲と制約

Coreに辞書検証・期間限定集計・Rules・共通ポリシー、Browserに同意・属性計測・保存・購読・判定スケジューラーを実装しています。CoreはDOMやJev SDKに依存しません。公開APIと詳しい設計は [仕様書一覧](docs/README.md)、判断と検証結果は [実装メモ](docs/09-local-implementation.md) を参照してください。

Jev接続と判定サーバーはM3、配布用ESM/型定義/IIFEとNext.jsの例はM4、公開準備はM5として残しています。npm公開・デプロイ・実サイト導入は行っていません。

通常の同一documentのDOMが対象です。iframe、Shadow DOM、特殊なCSS transformや重なりの完全な判定には対応しません。60秒無操作で表示時間の計測を止めるため、操作せず長文を読む時間も停止対象です。推薦品質やCV改善、他ブラウザでの互換性は、このローカル試験からは保証しません。
