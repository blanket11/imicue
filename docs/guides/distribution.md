# 配布ファイルとNext.jsの例を使う

ImicueはESM、型定義、通常のscriptタグで使うIIFEをローカルで生成できます。npmパッケージと配布用CDNは未公開です。まずこのリポジトリでビルドし、使う形式を確認してください。

前提は [ローカル環境の準備](../../README.md#ローカルデモを動かす)です。

## ローカルでビルドする

```sh
npm run build
```

| 生成先 | 内容 |
| --- | --- |
| `packages/core/dist`・`packages/browser/dist`・`packages/server/dist` | 各パッケージのESM、型定義、LICENSE |
| `dist/browser/imicue-0.1.0-dev.0.js` | CoreとRulesを含む単体ESM |
| `dist/browser/imicue-0.1.0-dev.0.iife.js` | 通常のscriptタグ用ファイル |
| `dist/browser/manifest.json` | バージョン、サイズ、SHA-384のSRI値 |
| `examples/next-static/out` | Next.jsが出力したHTML・JS・CSS |

ESMパッケージだけ必要な場合は `npm run build:packages`、単体ブラウザファイルだけなら `npm run build:browser` を使えます。ファイル名の版は開発版の値です。更新時は生成されたmanifestを確認し、古いファイルやSRI値と混ぜないでください。

## ESMとscriptタグの動きを比べる

```sh
npm run preview:distribution
```

[ESMデモ](http://127.0.0.1:5185/es/)と[IIFEデモ](http://127.0.0.1:5185/iife/)は生成した固定ファイルを読み込みます。計測を許可・開始し、集計と案内が動くことを確認します。

IIFEは `window.Imicue` に `createTracker`・`createRulesEngine`・`createRemoteEngine`・`version` を公開します。読み込みだけでは計測を始めません。既存の `window.Imicue` は上書きせず、重複読み込みは `imicue:global_conflict` で知らせます。

自分のサーバーで配信する場合は、生成したファイルを配置し、そのURLをscriptタグに指定します。次は同一Originに配置する例です。

```html
<script src="/assets/imicue-0.1.0-dev.0.iife.js" defer></script>
<script src="/assets/imicue-init.js" defer></script>
```

`imicue-init.js` で `window.Imicue.createTracker()` を使い、[辞書・同意・表示処理](integration.md)を接続します。CSPで許可する配信元は利用サイトの設定に合わせてください。SRIを付ける場合は、今回生成した `dist/browser/manifest.json` の値を使用します。

## Next.jsのページ移動を試す

```sh
npm run preview:next
```

[Next.js静的デモ](http://127.0.0.1:5184/)で計測を許可・開始し、「読書メモの検索例を開く」を操作します。候補のリンクは「候補のガイドを表示」を押すと現れます。

上部のガイド間を移動するとpageIdとpageViewIdが変わり、同じTrackerの記録と許可を維持します。再読み込みではリセットします。この例の保存先はメモリです。

初期モードはRulesです。「判定サーバー接続」を選ぶ場合だけ、別ターミナルで `npm run dev:server` を起動してください。モード変更時は許可と記録をリセットします。Next.js内には判定用のPOST APIを置いていません。

Next.jsのソースを編集する場合は `npm run dev:next` で開発サーバーを起動します。静的配信は5184、開発サーバーは5186を使います。検証範囲と受け入れ条件は [テストガイド](../06-implementation-and-tests.md)を参照してください。
