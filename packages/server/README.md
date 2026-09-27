# @imicue/server

サーバー管理の辞書、HTTP入力の検証、利用制限、Jevへの接続を扱います。ブラウザ向けのコードには含めないでください。

現在は `0.1.0-dev.0` の開発版で、npmには未公開です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。`npm run dev:server` でAPIキー不要のモックサーバーを起動できます。

モック試験はJevの判断品質を検証するものではありません。実APIではAPI利用料が発生します。キーはサーバー側の `TYPESAFE_API_KEY` に設定し、ソースやログへ書かないでください。

本番モードには共有カウンターを持つ利用制限フックが必要です。付属のメモリ内制限は開発用で、複数のサーバーを横断する予算管理は実装していません。Edge環境も未検証です。

[モック・Jevの接続手順](https://github.com/blanket11/imicue/blob/main/docs/guides/server-and-jev.md)と[HTTP契約・利用量制限](https://github.com/blanket11/imicue/blob/main/docs/05-security-and-privacy.md)を参照してください。ライセンスは同梱の `dist/LICENSE`（Apache-2.0）です。
