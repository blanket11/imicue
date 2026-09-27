# @imicue/browser

登録したdata属性と手動操作を計測し、Coreへ集計を渡すブラウザ用パッケージです。表示UIは含みません。

現在は `0.1.0-dev.0` の開発版で、npmには未公開です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。

```js
import { createTracker } from '@imicue/browser';
import { createRulesEngine } from '@imicue/core';

const tracker = createTracker({ definition, pageId: 'home', engine: createRulesEngine(), storage: 'memory' });
// 利用側の同意管理で許可された後に実行します。
tracker.setConsent('granted');
tracker.start();
```

definitionは利用側で用意する固定辞書です。importや初期化だけでは観測・保存・判定通信を始めません。同意撤回は `setConsent('denied')`、破棄は `destroy()` です。

SPAのページ移動は同じTrackerで `setPage(pageId)` を呼びます。通常のページ移動にも記録を引き継ぐ場合は `storage: 'session'` を明示し、各ページで許可とstartを接続します。記録は同一Origin・同じタブの直近30分が対象です。同意自体は保存しません。

[同意と表示処理を含む組み込み例](https://github.com/blanket11/imicue/blob/main/docs/guides/integration.md)と[ブラウザ計測の仕様](https://github.com/blanket11/imicue/blob/main/docs/03-browser-tracking.md)を参照してください。ライセンスは同梱の `dist/LICENSE`（Apache-2.0）です。
