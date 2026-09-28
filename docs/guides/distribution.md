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

[ESM検証画面](http://127.0.0.1:5185/es/)と[IIFE検証画面](http://127.0.0.1:5185/iife/)は生成した固定ファイルを読み込みます。計測を許可・開始し、集計と案内が動くことを確認します。

IIFEは `window.Imicue` に `createTracker`・`createRulesEngine`・`createRemoteEngine`・`version` を公開します。読み込みだけでは計測を始めません。既存の `window.Imicue` は上書きせず、重複読み込みは `imicue:global_conflict` で知らせます。

自分のサーバーで配信する場合は、生成したファイルを配置し、そのURLをscriptタグに指定します。次は同一Originに配置する例です。

```html
<script src="/assets/imicue-0.1.0-dev.0.iife.js" defer></script>
<script src="/assets/imicue-init.js" defer></script>
```

`imicue-init.js` で `window.Imicue.createTracker()` を使い、[辞書・開始停止・表示処理](integration.md)を接続します。CSPで許可する配信元は利用サイトの設定に合わせてください。SRIを付ける場合は、今回生成した `dist/browser/manifest.json` の値を使用します。

## Next.jsのページ移動を試す

```sh
npm run preview:next
```

[Next.js静的デモ](http://127.0.0.1:5184/)は、架空の製品「PACELET」のサイトです。計測は自動で始まり、閲覧内容に応じて機能・事例・資料請求・お問い合わせを右下に案内します。操作の手順は [製品サイトデモ](product-demo.md)を参照してください。

ページ移動ではpageIdとpageViewIdを更新し、同じTrackerを使い続けます。記録はsessionStorageに30分間保持し、再読み込み後も復元します。資料請求とお問い合わせはデモ内の完了表示だけで、入力内容を送信・保存しません。

初期モードはRulesです。左下のDebugでRemoteを選ぶ場合だけ、別ターミナルで `npm run dev:server` を起動してください。モード変更時は記録を削除して自動開始します。Next.js内には判定用のPOST APIを置いていません。

PACELETのソースを編集する場合は `npm run dev` で開発サーバーを起動します。静的配信は5184、開発サーバーは5183を使います。検証範囲と受け入れ条件は [テストガイド](../06-implementation-and-tests.md)を参照してください。
