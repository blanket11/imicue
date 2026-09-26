# M3の判定サーバーとモック検証

2026-09-26。M0〜M2をコミット `ac22c75` に保存し、`codex/m3-server-jev` でM3を実装した。対象は [06のM3](06-implementation-and-tests.md#5-m3の詳細と実apiゲート) と [07の後続依頼](07-codex-handoff.md#3-m2確認後jev接続を追加する依頼文)。Jev実APIは呼んでいない。

## 実装した通信経路

Browserの `createRemoteEngine()` はSnapshotを `POST /v1/decide` へ送る。同意と開始、15秒間隔、進行中1件、世代・revision・pageViewIdによる応答破棄は既存Trackerを使う。受信したDecisionも検証し、候補外ID、弱いスコア、辞書や要求との不一致は表示しない。障害時のRulesへの自動切り替えは行わない。

`@imicue/server` はサーバー設定の辞書を検証・保持する。受信した辞書やプロンプトは使わず、登録済みのsiteIdとdefinitionVersionから辞書を解決する。Fetch API形式のhandlerと、localhost用Node HTTP Adapterを分離した。

| 境界 | 実装した条件 |
| --- | --- |
| 受信 | JSON、既知フィールド・IDのみ。本文は宣言値と実読byte数の両方で32KiBまで |
| Origin | 完全一致の許可リスト、localhost開発以外はHTTPS。CORSは認証の代わりにはならない |
| Jevへの入力 | direct観測を意味へ展開。候補ごとのinstructionsにも説明を配置し、JSON全体を16KiBまでに制限 |
| 利用枠 | 開発用のメモリ内制限は同時2件、直近60秒で30回、直近24時間で100回 |
| 失敗時 | 回数枠を戻さない。HTTPがtimeoutしても、実際のprovider処理が終了するまで同時枠を保持 |
| 本番モード | `UsageLimiter.shared === true` のフックを必須にする。共有カウンターの実装責任は導入側にある |
| 接続上限 | SDKは2秒、サーバー・ブラウザの全体上限は各3秒。中断signalを伝播 |
| 再送 | SDKの再試行なし。Browserの400/409/413はインスタンス内で再送停止、429はRetry-Afterを尊重 |
| 応答 | no-store、固定エラーコードのみ。入力本文、スタック、認証情報は返さない。Browserは応答本文も32KiBまでに制限 |

メモリ内の制限は単一handler・単一プロセス用で、再起動すると消える。複数workerやserverlessで共有できる基盤は未実装。`shared` の指定だけで原子性や永続性が保証されるわけではなく、本番導入前に制限フックの実装を確認する必要がある。

## SDKとScoreの確認による変更

公式SDK `@typesafe-ai/sdk@0.6.0` と実際の型を使い、モデルは `jev-1.13.0` に固定した。baseURL、ログ無効、再試行ゼロを明示し、SDKの環境変数による既定値に依存しない。返った実際のモデルIDが設定と違えば `invalid_result` とする。

Scoreの値は段階の期待値で、小数も返る。Coreの整数制限を外し、有限な0〜3の値と `score = rawScore / 3` の整合性を検証するよう修正した。2.7を0.9へ正規化する回帰試験を追加した。confidenceは別の値として保持し、Rulesには付けない。確認した公式資料と日付は [08のS2・S5](08-references-and-decisions.md#s2) に記録した。

## ローカルで試す

Node.js 24.14.0、npm 11.9.0を使う。初回は `npm ci` を実行する。以下を別々のターミナルで起動する。

```sh
npm run dev
```

```sh
npm run dev:server
```

[モック接続デモ](http://127.0.0.1:5183/?engine=remote)で計測を許可・開始し、「検索例を開く」を操作する。通常コマンドのサーバーは常にモックで、APIキーが環境にあっても実APIへ接続しない。モックはRulesの値を変換した合成結果を返す。`mock-local-v1` と画面の「モック」で識別でき、Jevの推薦品質やconfidenceの妥当性を試す用途ではない。

サイト側とサーバー側は同じサンプル定義ファイルを参照する。RemoteEngineへ辞書そのものは送らない。`?engine=remote` はデモだけの固定モード指定で、任意の接続先URLやキーをqueryから読み取る仕組みはない。

ポートはブラウザ用5183、サーバー用5193。E2Eは4173と5193を使う。別アプリが使う5173・5174のプロセスは停止・変更していない。

## 実行した検証

macOS arm64、Node.js 24.14.0、npm 11.9.0、Chromium、1280×800を中心に実行した。

| コマンド・項目 | 結果 |
| --- | --- |
| `npm run typecheck` | 成功 |
| `npm run lint` | 成功 |
| `npm test` | 7ファイル、214件成功。M0〜M2の148件を含む |
| `npm run build` | 4ページの静的デモを生成 |
| `npm run check:bundle` | Browser + Core + Rulesはgzip 12,634 bytes。25KiB以内、server・Jev SDKの混入なし |
| `npm run test:e2e` | Chromiumで14件成功。従来11件とM3の3件 |
| `RUN_JEV_INTEGRATION=0 npm run test:jev` | SKIPを確認。実API成功には数えない |

HTTP試験では、未知フィールド・不正ID・重複行・旧辞書・CORS・巨大body・読み取り停止・provider失敗を確認した。実際のNode HTTPサーバーにchunked送信し、送信完了を待たずに413を返すことも確認した。利用枠は同時要求、失敗後の回数消費、日次上限、timeout後の同時枠の保持を検査した。

SDK試験は実SDKのfetchだけをモックに置き換えている。候補説明の配置、Scoreの小数、低confidence、候補外・不足・範囲外の応答、モデル不一致、429・5xx・通信失敗・timeout時の呼び出し1回を検証した。敵対的な説明から候補外IDが返るケースも拒否したが、実モデルが指示を無視できると証明した試験ではない。

Browser試験は、400/409/413の再送停止、429の待機、要求と応答の不一致、応答容量、読み取り停止、遅延応答を検査した。実ブラウザでは静的デモからlocalhostの別Originへ接続し、同意・開始前の通信ゼロ、モック応答、同意撤回後のデータとUIの維持、接続失敗時もガイドを開けることを確認した。

最初のE2E実行では既存のスクロール性能試験が1件失敗した。初回ResizeObserver通知に伴う再走査をスクロール処理として数えていたため、初期通知の完了後に計測するよう試験を修正した。再実行では14件すべて成功し、開始処理1.5ms、20回のスクロール中のdocument全走査0回だった。この測定は当該環境の参考値で、一般的な性能保証ではない。

## 未実施事項と次の作業

Jev実API試験、アカウントでのモデル利用可否、実モデルの推薦品質・言語差・課金・遅延は未確認。`test:jev` は合成データだけで1〜5回を実行する別コマンドとして用意した。実行フラグまたはキーがなければSKIPし、通常テストには含めない。

M4のESM/型定義/IIFE配布成果物とNext.js static export例は未実装。共有制限基盤、公開、デプロイ、実サイト導入、Issue・Projectの更新は行っていない。Apache-2.0 LICENSEも変更していない。

次の実装単位はM4。実API確認を行う場合は、それとは別にローカルのキー設定と明示的な実行許可を受け、最大5リクエストで確認する。
