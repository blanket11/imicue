# @imicue/core

Imicueの辞書検証、直近の行動の集計、Rules判定、候補の除外・見送りを扱います。DOMとJev SDKには依存しません。

現在は未公開の開発版です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。公開済みのnpmパッケージとして案内していません。

```js
import { createRulesEngine, evaluateSnapshot, validateDefinition } from '@imicue/core';

// definitionとsnapshotは利用側で作成する固定辞書と観測の集計です。
const decision = await evaluateSnapshot(validateDefinition(definition), snapshot, createRulesEngine());
```

Rulesのスコアは確率ではありません。表示されたことを読了や購入意思と断定せず、根拠が少ない場合は見送ります。データ契約・利用例はリポジトリのREADMEとdocs/02-data-contracts.mdを参照してください。ライセンスは同梱のdist/LICENSE（Apache-2.0）です。
