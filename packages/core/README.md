# @imicue/core

Imicueの辞書検証、直近の行動の集計、Rules判定、候補の除外・見送りを扱います。DOMとJev SDKには依存しません。

現在は `0.1.0-dev.0` の開発版で、npmには未公開です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。

```js
import { createRulesEngine, evaluateSnapshot, validateDefinition } from '@imicue/core';

// definitionとsnapshotは利用側で作成する固定辞書と観測の集計です。
const decision = await evaluateSnapshot(validateDefinition(definition), snapshot, createRulesEngine());
```

Rulesは最大100件の登録済み候補を評価します。スコアは確率ではありません。表示されたことを読了や購入意思と断定せず、根拠が少ない場合は見送ります。

[データ契約](https://github.com/blanket11/imicue/blob/main/docs/02-data-contracts.md)と[SDKの組み込み例](https://github.com/blanket11/imicue/blob/main/docs/guides/integration.md)を参照してください。ライセンスは同梱の `dist/LICENSE`（Apache-2.0）です。
