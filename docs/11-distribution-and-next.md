# M4の配布ファイルとNext.js静的デモ

2026-09-26。M3を `ef44942` にコミットし、`codex/m4-distribution-next` でM4を実装した。対象はESM・型定義・IIFEのローカル生成と、Next.js static exportの利用例。公開作業やJev実API試験は行っていない。

## 生成物を読み込んで検証する構成

`npm run build` はCore・Browser・ServerのESMと型定義を生成し、単体のブラウザ用ESM・IIFE、Vanillaデモ、Next.jsの静的出力を続けて作る。packageの出力先は各 `packages/*/dist`、単体ファイルは `dist/browser`。各配布先に既存のApache-2.0 LICENSEもコピーする。

通常の `@imicue/*` importは生成した `dist/index.js` と `dist/index.d.ts` を参照する。リポジトリ内のVite・Vitest・型検査・tsxだけは `imicue-source` 条件を明示し、変更中のソースを直接使う。Next.jsは生成したパッケージを使う。packageの `private: true` は維持している。

IIFEは `window.Imicue` に次の4項目だけを追加する。初期化や計測開始は利用側が明示する。

| API | 用途 |
| --- | --- |
| `createTracker` | 同意・観測・集計・判定を管理 |
| `createRulesEngine` | APIキー不要のローカル判定 |
| `createRemoteEngine` | 別サーバーの固定HTTP契約へ接続 |
| `version` | 配布ファイルの固定バージョン |

同名グローバルがあれば上書きせず、コンソールへ固定の `imicue:global_conflict` を出す。同じIIFEを再読込した場合も既存APIを保つ。同一root・siteIdでTrackerを二重開始すると、既存のBrowser実装が `duplicate_tracker` を診断し、後から開始した側は計測しない。

`dist/browser/manifest.json` にバージョン、ファイル名、通常サイズ、gzipサイズ、SHA-384のSRI値を記録する。パッケージ用の型定義と、単体のJavaScriptファイルは用途を分けている。TypeScriptではpackageのESMと型定義を使う。

## Next.jsは静的ファイルだけで配信する

Next.js 16.3.6、React/React DOM 19.3.0、対応する型定義19.3.0を固定した。Node.jsは既存の24.14.0、npmは11.9.0を継続する。`output: 'export'` と `trailingSlash: true` を設定し、ホームと3つのガイドを生成する。ビルド時のテレメトリーは無効にしている。

`TrackerSession` はこのデモのClient Componentで、React専用SDKではない。effect内でTrackerを作り、購読とpagehide listenerを登録する。cleanupでは購読を解除してdestroyする。サイト内のLink遷移は登録済みpageIdへ変換して `setPage()` に渡すため、記録と許可を維持しながらpageViewIdを更新する。未登録のパスではTrackerを置かない。

Rulesは静的ファイルだけで動く。画面で「判定サーバー接続」を選んだ場合だけ、localhost:5193へSnapshotを送信する。モードを変えるとTrackerを破棄して作り直し、許可と記録をリセットする。判定サーバーの通常起動はモックであり、Next.js側に秘密キーやPOST APIは置かない。

案内リンクは「候補のガイドを表示」の明示操作で表示する。表示直前に `canDisplay()` を確認し、shown・clicked・dismissedを記録する。ガイド内の確認完了はcompletedとして扱う。推薦リンクの固定hashをページ到達時にsourceへ変換するのは、この利用例の処理である。

## ローカルで動かす手順

初回は `npm ci` を実行する。その後、生成と配信を行う。

```sh
npm run build
npm run preview:next
```

[Next.js静的デモ](http://127.0.0.1:5184/)で、許可・開始・検索例の操作を行い、上部のガイドを移動する。判定サーバー接続を試す場合は、別ターミナルで `npm run dev:server` を実行する。Rulesでは不要。

単体のESM/IIFEを試す場合も、別ターミナルで配信する。

```sh
npm run preview:distribution
```

[ESM](http://127.0.0.1:5185/es/)と[IIFE](http://127.0.0.1:5185/iife/)は同じ辞書・操作・Rulesを使う。通常のscriptとmodule importの双方で、同意前の記録ゼロと同じ推薦結果を確かめられる。

`npm run dev:next` は5186でNext.jsの開発モードを起動するコマンド。受け入れ試験の配信は `next dev` ではなく、生成済みoutを読む静的サーバーで行った。プレビュー用サーバーはGET/HEADのみを扱い、存在しないパスをHTMLへ読み替えるSPA fallbackは設けていない。

## 自己配信とCSPの例

IIFEを自己配信する場合は、生成した固定ファイルとLICENSEを自分の静的ファイル置き場へコピーする。次は `/vendor/` へ配置した場合の例で、このリポジトリが公開しているURLではない。

```html
<script
  src="/vendor/imicue-0.1.0-dev.0.iife.js"
  integrity="sha384-ivfI/hov7mhUZ0RAS9iWPB02Gytveu14PB2MuiIi91D8Zp8NKuB1QFq12z6PDCd+"
  crossorigin="anonymous"></script>
<script type="module" src="/imicue-init.js"></script>
```

SRI値は今回の生成物の値。コードを変えて再生成したときはmanifestから新しい値を転記する。固定バージョン名のファイルを公開後に上書きする運用は想定していない。

初期化は外部の `imicue-init.js` に置き、`window.Imicue.createTracker()` を呼ぶ。許可とstartの接続は [READMEのSDK例](../README.md#sdkの最小例) と同じ。script取得とTrackerの作成自体は、観測開始とは別である。

配布デモでは次のCSPを使い、ブラウザでも検証した。

```text
default-src 'self'; script-src 'self'; style-src 'self';
connect-src 'none'; object-src 'none'; base-uri 'none'
```

RemoteEngineを使う場合は、connect-srcに許可した判定サーバーのOriginを追加する。localhost開発以外はHTTPSとする。このCSP例は単体の配布デモ用で、Next.jsのインラインscript向け設定を含むものではない。実CDNや本番CSPでの試験は未実施。

## 実行した受け入れ試験

macOS arm64、Node.js 24.14.0、npm 11.9.0を使用した。初回のChromium試験に加え、同日、Playwright同梱のFirefox 155.0とWebKit 26.6でも検証した。

| 検証 | 結果 |
| --- | --- |
| 型検査・lint | 成功 |
| Vitest | 8ファイル、215件成功。M3までの214件とReact lifecycle統合試験 |
| build | 3パッケージのESM/型定義、単体ESM/IIFE、Vanilla、Next.jsの静的出力を生成 |
| 単体ESM | gzip 12,659 bytes。Core・Browser・Rules・RemoteEngineを含む |
| IIFE | gzip 11,358 bytes。25KiB以内 |
| `check:distribution` | ソースなしの型利用、DOMなしimport、静的出力と秘密値の検査が成功 |
| Playwright | 24ケースをChromium・Firefox・WebKitで検証し、計72件成功。既存22ケースにページ横断の2ケースを追加 |

型の利用試験では、生成したdistとpackage.jsonだけを別のconsumerディレクトリへコピーし、NodeNextで型検査した。BrowserはNode型定義なしでも検査し、Serverを使うケースではNodeの型定義を明示した。Core/Browserのimport試験ではwindow・document・storageの参照を例外にして、読まれないことを確認した。

IIFE試験では同意前と開始前の記録ゼロ、ESMとの同じRules結果、グローバル競合、scriptの二重読み込み、二重Tracker開始を確認した。Next.js試験は、静的配信からのhydration、同一documentでのページ遷移、モック接続、モード変更による初期化、遷移前の遅い応答の破棄、JavaScript無効時のガイド閲覧を検査した。

Strict Modeは設定だけで合格にせず、実際のReactでsetup 2回・cleanup 1回が初回に起きることを確認した。その後の操作が1回だけ記録され、unmount後にObserverが残らず、同じdocument/siteIdを別Trackerが使用できることを検証した。ここでのDOMとObserverはjsdomとテスト用の実装で、Next.jsの静的出力E2Eとは分けている。

秘密値の検査では合成の `TYPESAFE_API_KEY=IMICUE_SYNTHETIC_SECRET_M4` をビルド環境に設定した。配布ファイルとNext.jsの公開用HTML・JS等48ファイルを走査し、この値、キー設定名、Jev SDK、プロバイダー接続URLが混入していないことを確認した。実キーを読み出して検査したものではない。

## 未実施事項と次の作業

npm公開、実CDN、デプロイ、ドメイン設定、既存サイトへの導入、Issue・Project変更は行っていない。Jev実API、Edge環境、Safari製品版、iPhone/iPad実機、実端末のsleep、実モデルの品質・料金・遅延は未検証。Next.jsの開発サーバー自体も受け入れ試験には使っていない。

Safariを対象外にしているわけではない。PlaywrightのWebKit試験は成功したが、[公式説明](https://playwright.dev/docs/browsers#webkit)にあるとおりSafari製品版とは異なる。ローカルのSafari 26.4でWebDriverセッションを試したところ、「リモートオートメーション」が無効で作成できなかった。システム設定は変更していない。FirefoxもPlaywright同梱ビルドでの結果であり、全OS・過去バージョンの保証ではない。

次の作業単位はM5の公開準備。利用手順・制約・評価・貢献方法の整理に加え、Safari製品版での確認と、許可後の少量のJev実API試験を進める。公開操作と有料API試験は、引き続き別の明示的な指示を受けて行う。

## ページ横断で保持する内容

保持するのは同じ閲覧セッション内の直近30分の観測・操作・案内結果で、永続的な個人プロフィールではない。

| 利用方法 | TOP → 機能ガイド → TOPでの保持 |
| --- | --- |
| 現状のNext.jsデモ | 同じTrackerをlayout内で維持し、Link遷移で `setPage()` を呼ぶため保持する。再読み込みでは消える |
| 現状のVanillaデモ | memory設定。通常のページ遷移では消える |
| SDKの `storage: 'session'` | 同じ辞書、同一Origin・同じタブなら、通常のページ遷移・再読み込み後も許可とstartを受けて復元する |

同意自体は保存しない。利用サイトの同意管理から各ページのTrackerへ許可を渡す必要がある。同意撤回・リセットで保存分も削除し、保存を利用できない環境ではメモリのみで動く。別ドメイン、別端末、翌日の再訪者を識別する機能ではない。

今回の追加試験では、Next.jsで機能ガイドの表示条件を満たしてTOPへ戻り、記録の保持と、そのガイドを除外した新しいページの判定を確認した。配布済みESMの試験ではsession保存を明示し、文書全体を読み込み直しても操作・確認完了の記録が復元されること、許可・start前は復元しないこと、撤回後は再読み込みしても記録が戻らないことを確認した。いずれも3エンジンで成功した。

「表示条件を満たした」は読了の断定ではない。また、機能を見たから次は料金に興味がある、と固定で推測する実装でもない。既に表示条件を満たしたガイドを候補から外し、残る候補を辞書の関連と観測で採点する。関連や根拠が足りなければ見送る。次に案内したいコンテンツとの関連付けと、実際の判定品質の評価が必要になる。

## 費用と実API試験の準備

ローカルのRules・モック試験にJev API料金やホスティング料金はかからない。今後の費用候補は、Jevの入力トークン、判定サーバーとログの運用、必要に応じたドメイン取得・更新。静的な説明サイトやRulesデモは無料枠から始められる。例えば[Cloudflare Pagesの公式料金](https://developers.cloudflare.com/pages/functions/pricing/)では、Functionsを呼ばない静的ファイルのリクエストは無料とされている。公開先を決定・設定したものではない。

2026-09-26に確認した[Jev 1.13の公式料金](https://docs.typesafe.ai/models)は入力100万トークンあたり0.042米ドル、出力は無料。仮に1判定の合計入力が2,000トークンなら1万判定で0.84米ドルとなる。これは実測ではなく概算で、サーバー代・税・為替等は含めない。

Jevを使って公開する前に、ローカルで実API試験を行う。モックでは認証、実モデルの応答、品質、料金、遅延は確認できない。まず合成データ1回・再試行なしで疎通を確かめ、その後に複数の観測パターンで品質を評価する。キーは利用者がローカルの `TYPESAFE_API_KEY` に設定し、値を表示・保存しない。実行コマンドは [README](../README.md#jev実api試験は許可後に別コマンドで行う)を参照する。
