# Cloudflare Pagesで紹介サイトを配信する

[紹介サイト](https://imicue.push.tokyo/)はCloudflare Pagesで公開している。この文書はメンテナー向けに配信構成と更新時の確認事項をまとめたもの。公開するのは `dist/site` の静的ファイルだけで、Jev判定サーバーは含めない。

## 配信に使うファイルと検査

- `site/public/_headers`: CSP、MIME型の誤認防止、フレーム内表示の禁止、Referrerの送信制限。
- `site/404.html`: 存在しないURLの案内。トップページへ戻るリンクを表示する。
- `check:site`: 出力ファイルの種類、参照先、容量、ヘッダー、サーバー専用設定の混入を検査する。
- `preview:site`: ビルド済みのヘッダーと404ページを適用するローカルサーバー。

CSPでは同一オリジンのスクリプト・CSS・画像・フォントだけを許可する。アイコン用のdata URL画像も許可する。インラインスクリプト、外部の読み込み、fetchなどの通信、フォーム送信、外部ページからの埋め込みは許可しない。紹介サイトのデモはブラウザ内で判定するため、この制限で動く。

Cloudflare Pagesは出力先の `_headers` を静的レスポンスへ適用する。トップレベルに `404.html` がない場合は、存在しないパスをトップページへ送るSPA用の動作になるため、今回は明示的な404を用意した。参照: [Headers](https://developers.cloudflare.com/pages/configuration/headers/)、[Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)。

キャッシュはPagesの既定動作を使う。独自の長期キャッシュやCache Rulesは追加しない。キャッシュ更新・圧縮・HTTPS・ヘッダーの反映は、変更後の公開環境でも確認する。ローカルの成功だけで配信設定の成功とは扱わない。

## ローカルで配布物を確認する

```sh
npm run build:site
npm run check:site
npm run test:site
npm run preview:site
```

最後のコマンドで [5187のプレビュー](http://127.0.0.1:5187/)を開く。存在しないURLでは404ページになる。`test:site` は4187を使うため、5187のプレビューと同時に実行できる。

プレビューはこのサイトが使う単一の `/*` ヘッダールールだけを読み込む。CloudflareのルーティングやCDNを再現するものではない。開発用の `dev:site` はHMRを使うため、公開用CSPの確認には使わない。

## PagesのGit連携に設定する値

サイト変更はPRでレビューしてmainへ取り込む。PagesのGit連携には次の値を使う。新しい配信先を作る場合は、そのリポジトリと運用に合わせて設定する。

| 項目 | 値 |
| --- | --- |
| リポジトリ | `blanket11/imicue` |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | リポジトリ直下。`site` に変更しない |
| Build command | `npm ci --include=dev && npm run build:site && npm run check:site` |
| Build output directory | `dist/site` |
| Build system | v3 |
| 環境変数 `NODE_VERSION` | `24.14.0` |
| 環境変数 `SKIP_DEPENDENCY_INSTALL` | `1` |

自動インストールを止め、ビルドコマンド内の `npm ci` でlockfileどおりに依存関係を入れる。Node.jsのバージョンは既存の `.nvmrc` と揃える。Node.js 24.14.0にはnpm 11.9.0が同梱される。参照: [Pagesのビルド環境](https://developers.cloudflare.com/pages/configuration/build-image/)、[Node.jsのリリース記録](https://nodejs.org/en/blog/release/v24.14.0)。

JevのAPIキー、CloudflareのAPIトークン、アカウントID、独自ドメインをビルド環境変数やリポジトリへ追加する必要はない。Git連携の認証とカスタムドメインは管理画面で扱う。

この構成ではPages Functionsを使わず、npmパッケージの公開も行わない。配信の料金やビルド上限は、[公式料金](https://developers.cloudflare.com/pages/functions/pricing/)と[制限](https://developers.cloudflare.com/pages/platform/limits/)、利用するプランで確認する。

## 配信先の作成・変更時に確認すること

1. Cloudflareにログインし、Workers & PagesからPagesのGit連携を選ぶ。アカウント作成が必要な場合はオーナーが行う。GitHub連携の対象はこのリポジトリに限定する。
2. 上表を設定する。保存・デプロイを実行すると、PagesのURLでインターネットに公開される。公開範囲が決まってから操作する。
3. 生成されたURLで通常表示、4つの閲覧例の判定、コピー、404、HTTPS、CSP違反がないことを確認する。ローカルの検証だけで成功扱いにしない。
4. 自動デプロイの範囲を確認する。Git連携後はmainへのpushで本番配信が更新される。初期運用ではPreview branch deploymentsを無効にし、作業ブランチやPRを自動公開しない。別途プレビュー公開が必要になった時点で見直す。
5. カスタムドメインをPages側に追加し、そこで表示された値でDNSのCNAMEを設定する。既存DNSサービスを維持できる。アカウント情報や私的な管理情報は公開文書に書かない。
6. 独自ドメインでも確認し、直前のデプロイへ戻す方法を確認する。

Git連携の権限と自動配信の動作: [GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)、[Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)。独自ドメインの手順: [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)。

## 配信後の確認と未検証の範囲

ローカルでは公開用ヘッダーを付け、Chromium・Firefox・WebKitでデモ、キーボード操作、コピーの成功・拒否、狭い幅、JavaScript無効時の表示を検査する。追加の試験では、インラインスクリプトと判定通信がCSPで拒否されること、存在しないパスでHTTP 404を返して復帰できることを確認する。

公開URLでトップページと存在しないパスを開き、HTTPS、HTTPステータス、CSPなどのヘッダー、更新した内容が確認できることを調べる。キャッシュの反映やCloudflareのルール解析は、ローカルプレビューでは保証できない。

Safari製品版での紹介サイト、モバイル実機、本番Jevサーバーの共有利用制限、人による残りの推薦品質評価は未検証または未実装。既存のVanillaデモでのSafari試験と混同しない。

2026-09-26に配信設定を追加した際は、型検査・lint、サイトのビルドと出力検査、配布検査、3ブラウザ計15件のサイトE2Eが成功した。出力への不要な環境ファイル追加とヘッダー改変を検査が拒否することも確認し、試験後は元に戻した。Codex内ブラウザでも404からの復帰とRulesの判定を確認した。この記録でCoreなどの実装は変えておらず、既存の233件とデモE2E 84件は当時の前回結果を参照した。変更後の結果は各PRの検証記録を確認する。
