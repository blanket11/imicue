# 判定サーバーとJevに接続する

ブラウザからサーバーへ判定を依頼する構成を試す手順です。最初にモックで通信を確認し、意味の説明を使う判断が必要ならJevへ切り替えます。Rulesはブラウザだけで動くため、サーバーを起動する必要はありません。

前提は [ローカル環境の準備](../../README.md#ローカルデモを動かす)です。コマンドはすべてリポジトリのルートで実行します。

## モックサーバーに接続する

`npm run dev` を動かしたまま、別のターミナルで起動します。

```sh
npm run dev:server
```

[PACELET](http://127.0.0.1:5183/)で左下の「Imicue Debug」を開き、EngineをRemoteに切り替えます。パネルを閉じてボード機能と予定表の説明を閲覧し、再びDebugを開いてDecisionの `engine.model` が `mock-local-v1` であることを確認してください。判定の開始間隔は最低15秒です。

サーバーは `127.0.0.1:5193` で待ち受けます。このコマンドはAPIキーが環境に存在してもモックを使い、外部APIを呼びません。スコアとconfidenceは通信確認用の合成値で、Jevの判断品質を再現するものではありません。DebugでRulesを選ぶとブラウザ内の判定に戻ります。Engineを切り替えると記録を削除して自動開始します。

## Jevに接続する

**以下はJevの実APIを呼び、API利用料が発生する手順です。** 実行する人が利用範囲と費用を確認したうえで、有効化フラグを指定します。通常の `npm run check` から実APIが呼ばれることはありません。

リポジトリのルートに、Git管理外の `.env.local` を作ります。

```dotenv
TYPESAFE_API_KEY=発行したAPIキー
```

キーはサーバーでだけ使います。ソースコード、ブラウザ用の環境変数、Issue、ログへ貼り付けないでください。`.env.local` は起動コマンドの `--env-file` で読み込みます。ファイルを置くだけでは、以下のNodeスクリプトには読み込まれません。

最初は、固定の合成データを1回判定して接続を確認します。

```sh
RUN_JEV_INTEGRATION=1 JEV_INTEGRATION_REQUESTS=1 node --env-file=.env.local --import tsx --conditions=imicue-source scripts/jev-integration.ts
```

判定の種類とモデルが表示されます。`engine_unavailable` や `invalid_result` が出た場合は成功として扱わず、キーの有効性や接続設定を確認してください。回数の指定は1〜5で、自動再試行はありません。

ブラウザから接続する場合は、モックサーバーを停止してから次を実行します。

```sh
RUN_JEV_SERVER=1 node --env-file=.env.local --import tsx --conditions=imicue-source examples/server-node/index.ts --jev
```

[PACELET](http://127.0.0.1:5183/)のDebugでRemoteに切り替えます。閲覧に応じてAPIを呼び得るため、確認が済んだらDebugで計測を停止し、ターミナルでサーバーを停止してください。100候補の試験には、別途起動する[開発用画面](development-fixtures.md#100件の案内先を閲覧だけで試す)を使います。

現在のJev判定ポリシーは `jev-rubric-v4` です。最大100件を全件評価し、要求の容量に応じて分割します。分割後の一部だけが成功しても案内を出しません。Jevの推薦根拠は最終観測が直近5分以内のシグナルに限定し、記録と既読・完了による除外は30分保持します。具体的な辞書説明と、場面ごとの評価が必要です。

## SDKで接続先を指定する

[組み込み例](integration.md)の `engine` を、次のように置き換えます。

```js
import { createRemoteEngine } from '@imicue/browser';

const engine = createRemoteEngine({
  endpoint: 'http://127.0.0.1:5193/v1/decide',
  allowedOrigins: ['http://127.0.0.1:5193'],
});
```

同一Originなら `endpoint: '/v1/decide'` を使えます。localhost以外はHTTPSが必要です。送信するのは観測の集計であるSnapshotだけで、辞書・プロンプト・APIキーをブラウザから渡しません。辞書はサーバーで固定して解決します。

通信失敗時は見送り、Rulesへ自動で切り替えません。400・409・413を受け取ると、そのRemoteEngineは再送を止めます。辞書や設定を修正してインスタンスを作り直してください。429では `Retry-After` に従って待機し、その後の判定要求で再開します。

## 評価と本番運用へ進む

接続できたことだけでは、案内内容の妥当性は確認できません。[判定方式の仕様](../04-decision-engines.md)と[100候補の評価記録](../21-candidate-scale.md)を読み、利用する辞書で評価してください。記録には再実行コマンドと測定条件を載せています。

本番モードには、判定受付と外部API呼び出しの両方で、共有カウンターを持つ利用制限が必要です。付属のメモリ内制限は開発用で、共有基盤の実装は含みません。Core・Browser・Serverと辞書の版を合わせて更新する必要もあります。[HTTP契約と課金制限](../05-security-and-privacy.md)を確認してから本番向けの構成を用意してください。
