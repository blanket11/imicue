# @imicue/browser

登録したdata属性と手動操作を計測し、Coreへ集計を渡すブラウザ用パッケージです。表示UIは含みません。

現在は `0.1.0-dev.0` の開発版で、npmには未公開です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。

```js
import { createTracker } from '@imicue/browser';
import { createRulesEngine } from '@imicue/core';

const tracker = createTracker({
  definition, pageId: 'home', engine: createRulesEngine(),
  storage: 'memory', collection: { mode: 'auto' },
});
```

definitionは利用側で用意する固定辞書です。`auto` は初期化時に開始します。`manual` は `start()` を待ち、`disabled` は開始操作があっても計測しません。import自体にはDOM操作や通信の副作用はありません。

開始タイミングと同意管理は利用サイトが決めます。停止には `stop()`、記録・保存分・抑制履歴の削除には `reset()` を使います。停止して削除する場合は、この順に両方を呼び、サイト側の案内UIも取り除きます。`destroy()` は監視・購読とメモリを解放し、session保存分は維持します。

`collection` 省略時は、後方互換のため従来の `setConsent('granted')` → `start()` が必要です。`setConsent()` は互換APIとして残しています。詳細は[開始モードと移行方法](https://github.com/blanket11/imicue/blob/main/docs/guides/collection.md)を参照してください。

SPAのページ移動は同じTrackerで `setPage(pageId)` を呼びます。通常のページ移動には、各ページで同じ辞書と `storage: 'session'` を指定します。計測開始時に同じOrigin・同じタブの直近30分の記録を復元します。同意状態や開始モード自体は保存しません。

[開始・停止と表示処理を含む組み込み例](https://github.com/blanket11/imicue/blob/main/docs/guides/integration.md)と[ブラウザ計測の仕様](https://github.com/blanket11/imicue/blob/main/docs/03-browser-tracking.md)を参照してください。ライセンスは同梱の `dist/LICENSE`（Apache-2.0）です。
