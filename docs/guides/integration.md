# 辞書と計測をページに組み込む

Imicueを組み込むには、観測する表示・操作と案内先を辞書に登録し、利用サイトで同意と表示処理を接続します。このガイドはJavaScriptでWebページを実装する人向けです。まず [動くVanillaの例](../../examples/vanilla/main.js)を確認し、以下を自分のページに合わせて変更してください。

現在はnpm未公開のため、パッケージ名を使う以下のコードは、このリポジトリのworkspaces内で `npm run build:packages` を実行して使います。外部のページで単体ファイルを使う場合は [配布ファイルの手順](distribution.md)を参照してください。

## 観測する内容と案内先を登録する

`definition.js` に固定の辞書を置きます。次は架空の契約書検索ページです。`signals` は観測する表示・操作、`contents` は案内先、`pages` は計測するページを表します。

```js
export const definition = {
  schemaVersion: '0.1',
  siteId: 'contract-example',
  definitionVersion: 'example-1',
  topics: {},
  signals: {
    'search-overview': {
      kind: 'content',
      label: '契約書検索の紹介',
      description: '契約書の本文から語句を探す機能を説明するセクション',
      productId: 'contract-example',
    },
    'search-example-opened': {
      kind: 'action',
      label: '検索例を開く操作',
      description: '本文から条項を探す固定の検索例を開く操作。入力文は記録しない',
      productId: 'contract-example',
    },
  },
  contents: {
    'search-guide': {
      title: '契約書の全文検索ガイド',
      description: '契約書の本文から語句を探し、必要な条項を確認する手順',
      href: '/guides/search/',
      enabled: true,
      productId: 'contract-example',
      relatedSignalIds: ['search-overview', 'search-example-opened'],
    },
  },
  pages: {
    home: { productId: 'contract-example' },
  },
};
```

`/guides/search/` は利用サイトが用意する案内先です。Imicueがページを生成するわけではありません。辞書や対象ページを変えたら `definitionVersion` も更新してください。型と必須条件は [データ契約](../02-data-contracts.md)にあります。

Rulesは `relatedSignalIds` やtopicの対応関係を使います。Jevはサーバーで辞書の説明を展開して候補を評価します。どちらも、未登録のURLを生成して案内する仕組みではありません。

## HTMLに観測するIDを付ける

```html
<section data-imicue-signal="search-overview">
  <h2>契約書の本文から探す</h2>
  <p>ファイル名を覚えていなくても、本文中の語句から条項を探せます。</p>
  <button id="open-example" type="button">検索例を開く</button>
  <p id="search-example" hidden>検索語「契約期間」に対応する条項の表示例です。</p>
</section>

<div data-imicue-ignore>
  <button id="allow-measurement" type="button">計測を許可して開始</button>
  <button id="revoke-measurement" type="button">同意を撤回</button>
</div>
<aside id="recommendation" data-imicue-source="recommendation" aria-live="polite"></aside>
```

`data-imicue-signal` には、辞書で `kind: 'content'` にしたIDを指定します。表示条件を満たすと有効な閲覧として記録します。手動の `track()` は `kind: 'action'` のIDだけを受け付けます。任意のmetadataや入力テキストは渡せません。

`data-imicue-ignore` で対象外を示し、`data-imicue-source="recommendation"` で推薦由来の記録を分離します。記録する単位や表示条件は [ブラウザ計測の仕様](../03-browser-tracking.md)を参照してください。

## 同意と結果の表示を接続する

次のコードを、上のHTMLがあるページのブラウザ用スクリプトから実行します。同意ボタンは動作説明のための最小例です。利用サイトに同意管理がある場合は、そこから許可・撤回を接続してください。

```js
import { createTracker } from '@imicue/browser';
import { createRulesEngine } from '@imicue/core';
import { definition } from './definition.js';

const tracker = createTracker({
  definition,
  pageId: 'home',
  engine: createRulesEngine(),
  storage: 'memory',
});
const container = document.querySelector('#recommendation');

const unsubscribe = tracker.onDecision((decision) => {
  container.replaceChildren();
  if (decision.type !== 'recommend' || !tracker.canDisplay(decision)) return;

  const content = definition.contents[decision.contentId];
  const link = document.createElement('a');
  link.href = content.href;
  link.textContent = content.title;
  container.append(link);
  tracker.recordOutcome(decision.contentId, 'shown');
});

document.querySelector('#allow-measurement').addEventListener('click', () => {
  tracker.setConsent('granted');
  tracker.start();
});
document.querySelector('#revoke-measurement').addEventListener('click', () => {
  tracker.setConsent('denied');
  container.replaceChildren();
});
document.querySelector('#open-example').addEventListener('click', () => {
  document.querySelector('#search-example').hidden = false;
  tracker.track('search-example-opened', { source: 'direct' });
});

window.addEventListener('pagehide', () => {
  unsubscribe();
  tracker.destroy();
}, { once: true });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
```

初期化だけでは計測を始めません。未許可の操作も記録しません。見送り時は通常のページをそのまま使えるようにし、案内が必ず出ることを前提にしないでください。

この例は、ブラウザの「戻る」でページがキャッシュから復帰した場合に再読み込みし、Trackerを作り直します。SPAで画面を切り替える場合は、次の節の方法で同じTrackerを維持できます。

表示する直前に `canDisplay()` で有効性を確認し、実際に表示したときだけ `recordOutcome(contentId, 'shown')` を呼びます。閉じる・確認完了も利用サイトの操作に合わせて記録できます。遅延表示やアニメーションを追加する場合は、表示時点で改めて有効性を確認してください。

## ページ移動後も記録を使う

SPAでは同じTrackerを維持して `setPage(pageId)` を呼びます。画面遷移時には、前のページで表示した案内も取り除いてください。コンポーネントを破棄する場合は購読を解除し、`destroy()` を呼びます。

通常のリンク遷移や再読み込みでも記録を使うには、各ページで同じ辞書と `storage: 'session'` を指定します。同一Origin・同じタブのsessionStorageから、許可と `start()` の後に直近30分の記録を復元します。同意は保存しません。

表示条件を満たした案内先や、確認完了した案内先は再推薦から除外します。機能ガイドを見たことだけで、次に料金へ興味があると断定するわけではありません。次の候補にも辞書の関連と観測の根拠が必要です。[ページ横断デモ](local-demos.md#ページ移動後の記録を試す)で復元と撤回を確かめてください。

## 用語と参照先

| 用語 | 意味 |
| --- | --- |
| Definition | 観測するID、その意味、案内先の対応を定義した辞書 |
| Snapshot | 期間内の表示・操作・案内結果を集計した判定入力 |
| Decision | 登録済み候補への推薦、または見送り |
| Tracker | 同意、観測、保存、判定の実行を管理するブラウザ側のインスタンス |

Jevを使う場合は [判定サーバーへの接続](server-and-jev.md)、設定と制約の全体像は [ドキュメント一覧](../README.md)を参照してください。
