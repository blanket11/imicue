# M0〜M2 ローカル版の実装メモ

対象は基盤、Core、Browser、Vanilla JSデモです。Jev実API、判定サーバー、公開、デプロイ、既存サイトへの導入、Issue・Project変更は含みません。

## 実装の配置

| 場所 | 内容 |
| --- | --- |
| `packages/core/src` | 不変の辞書、型、snapshot検証、期間限定集計、Rules、共通ポリシー |
| `packages/browser/src` | DOM計測、同意と開始・停止、任意のsession保存、購読、スケジューラー |
| `examples/vanilla` | DemoContractのトップと3つのガイド、ローカル確認パネル、案内カード |
| `packages/*/test` | 時計・DOM監視・判定エンジンを制御する単体テスト |
| `tests/e2e` | 静的ビルドを配信するChromium試験 |
| `scripts/check-bundle.mjs` | Browser/Core/Rulesの依存とgzipサイズの検査 |

## 細部の判断

- Node 24系がLTSであることを確認し、手元の24.14.0とnpm 11.9.0を固定した。依存は単一のlockfileに固定。TypeScript 7は利用中のtypescript-eslintの対応範囲外のため、対応する6.0.3を選んだ。
- M3で初めて必要になる空のserverパッケージは作っていない。CoreとBrowserの2つのprivate workspaceから開始した。
- M2のbuildはVanillaデモの静的成果物を作る。SDKの配布用型定義、IIFE、Next.js例はM4に残す。サイズ検査用コードはメモリ内だけに生成する。
- `ObservationStore` は単調時計を注入でき、内部記録を相対時刻で書き出す。Browserが保存時刻・最後の活動時刻と辞書バージョンを検証して復元する。定義の公開期間は暦日時なのでepoch時計で比較する。
- `getSnapshot()` は確定済みの表示区間を返す。読出しだけでrevisionは増えない。表示中の時間は最大5秒ごと、離脱や停止時に確定する。
- `evaluate()` は即時実行できないとき、最新状態の評価を1件だけ待機させ、`undefined` を返す。結果は `onDecision()` でも受け取れる。手動実行も15秒間隔と同時実行1件の制限を守る。
- 表示前の確認を `tracker.canDisplay(decision)` にまとめた。許可、開始状態、世代、ページ、revision、候補、期限、URL、抑制を再確認する。UIは引き続きexample側で所有する。
- デモはメモリ保存を選んだ。別ページの移動後は許可・開始をやり直す。推薦リンクの固定hashはデモ自身がsourceとして引き継ぐ。SDKはURLやreferrerからsourceを推測しない。
- 合成シナリオの期待結果は実装時の仮設定であり、利用者による許容候補のレビューやJevとの品質比較を済ませたものではない。

## 検証結果

2026-09-26に、macOS（darwin / arm64）、Node 24.14.0、npm 11.9.0で `npm ci && npm run check` を実行し、すべて成功した。

| 検証 | 結果 |
| --- | --- |
| `npm ci` | 単一lockfileから依存解決成功。実行時のnpm監査は検出0件 |
| `npm run typecheck` | TypeScript strictの型検査成功 |
| `npm run lint` | ESLint成功 |
| `npm test` | 4ファイル、148件成功（Core 102件、Browser 46件） |
| `npm run build` | 4ページのVanilla静的ビルド成功 |
| `npm run check:bundle` | Browser＋Core＋Rules: 38,444バイト、gzip 10,786バイト。初期目標25KiB以内。Jev SDK・server・React依存なし |
| `npm run test:e2e` | Chromium 153.0.8010.12、11件成功。静的ビルドをlocalhostから配信 |
| 日本語の文章検査 | READMEと本メモにnatural-japaneseの通常lintを実行。指摘なし |

単体テストはC01/C03/C04、B01〜B10、D01〜D05に対応する。辞書参照・不正URL、30分境界、容量超過、Rulesの式・見送り、同意前のstorageアクセス禁止、保存データ不正、重複計測、タイマー遅延、停止・撤回・ページ変更・reset・revision変更後の応答破棄を検証した。12件の合成シナリオも含む。

実ブラウザでは高さ3,000pxのsectionと高さ800pxのviewport、Mutationによる追加・変更・削除、外部への判定通信0件、カードとフォーム・モーダルの非干渉、推薦由来の記録、4種類のoutcome、JavaScript無効時の通常ナビゲーション、375px幅での横はみ出しなしを確認した。DesktopとMobileのスクリーンショットも目視した。

201要素を置く負荷試験では、監視上限・推薦見送りと、20回のscrollイベント中に全documentの対象走査が0回であることを確認した。最終実行の開始処理は約2.1ms、scroll試験全体は約316.8msだった。後者は待機時間を含み、CPU処理時間や一般的な性能保証ではない。

実ブラウザでmain threadを3.5秒止めた試験では、遅延したタイマーを閲覧時間に加算せず、利用操作後に計測が再開した。タブ非表示と復帰、60秒無操作、端末停止相当の時計差は単体テストでも確認した。ただし、実際のタブ非表示・OSの物理的スリープは今回の実ブラウザ試験では未確認。CDPによるfreeze指定はこの試験環境で実際には停止しなかったため、確認実績に含めていない。Firefox・WebKit・実機モバイルも未試験。

実装中に見つかった確認パネル更新によるDOM走査ループ、30分を超えて続く監視容量不足、遅延タイマーと無操作期限の境界、限定rootの外側にある祖先属性の変更を修正し、回帰テストを追加した。未解決のテスト失敗はない。

## 後続作業

次はM3の固定HTTP契約、サーバー管理辞書、入力・容量・利用制限、Jev Adapterのモック試験です。実API確認は別途許可を受ける段階に残します。C02、S01〜S03のHTTP/課金制限、P01/P02のNext.js/IIFEは今回の試験対象外です。D04/D05は共通の型・出力ゲートを合成エンジンで検査し、実際のJevの挙動を確認したとは扱いません。

## 依存関係の確認資料

2026-09-26に [Node.js Releases](https://nodejs.org/en/about/previous-releases)、[npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)、[TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)、[Vitest](https://vitest.dev/guide/)、[Vite](https://vite.dev/guide/)、[Playwright](https://playwright.dev/docs/intro)、[typescript-eslint](https://typescript-eslint.io/getting-started/) を確認した。具体的な採用バージョンと互換性はnpmの公開package metadataも照合した。
