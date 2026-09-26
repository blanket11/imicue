# @imicue/server

サーバー管理の辞書、HTTP入力の検証、利用制限、Jevへの接続を扱います。ブラウザ向けのコードには含めないでください。

現在は未公開の開発版です。リポジトリのルートで `npm ci` と `npm run build:packages` を実行し、workspaces内から利用します。`npm run dev:server` でAPIキー不要のモックサーバーを起動できます。

モック試験はJevの判断品質を検証するものではありません。実API試験は別途許可を受け、キーをサーバー側の `TYPESAFE_API_KEY` に設定した後に行います。キーをソースやログへ書かないでください。

本番モードには共有カウンターを持つ利用制限フックが必要です。付属のメモリ内制限は開発用で、複数のサーバーを横断する予算管理は実装していません。Edge環境も未検証です。

HTTP契約と利用手順はリポジトリのdocs/05-security-and-privacy.md、docs/10-server-implementation.md、READMEを参照してください。ライセンスは同梱のdist/LICENSE（Apache-2.0）です。
