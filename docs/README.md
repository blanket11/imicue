# Imicueの使い方と仕様

Imicueは、登録した閲覧・操作の記録と辞書を使い、次に案内する候補を選ぶライブラリです。表示UIは利用サイトで組み込みます。

初めて使う場合は、[ローカルデモの起動](../README.md#ローカルデモを動かす)と[確認する操作](guides/local-demos.md)から始めてください。組み込み時は利用ガイド、型や判定条件を調べるときはリファレンスを参照します。設計・検証の記録を順に通読する必要はありません。

このドキュメントは開発版 `0.1.0-dev.0` のコードに対応します。ソースと[紹介サイト](https://imicue.push.tokyo/)は公開しています。npmパッケージと配布用CDNは未公開です。

## 目的から手順を選ぶ

| 目的 | 利用ガイド |
| --- | --- |
| 計測とRules判定、100件の候補、ページ横断を試す | [ローカルデモで動きを確かめる](guides/local-demos.md) |
| 自動開始・手動開始・無効化を選ぶ | [計測開始のタイミング](guides/collection.md) |
| 自分のページに観測する内容と案内先を登録する | [辞書と計測をページに組み込む](guides/integration.md) |
| モックで通信を確認し、Jevへ接続する | [判定サーバーとJevに接続する](guides/server-and-jev.md) |
| ESM、scriptタグ、Next.jsの例を使う | [配布ファイルとNext.js](guides/distribution.md) |
| 紹介サイトを編集する | [紹介サイトの開発](19-public-site-and-operations.md) |
| 静的サイトを公開する | [Cloudflare Pagesの設定](20-cloudflare-pages.md) |

Jevの実APIを使う手順ではAPI利用料が発生します。Rules、モック接続、通常のテストは実APIを呼びません。

## リファレンス

| 文書 | 調べられること |
| --- | --- |
| [目的と構成](01-product-and-architecture.md) | Imicueの役割、Core・Browser・Serverの分担 |
| [データ契約](02-data-contracts.md) | 辞書、観測、案内先、判定結果の型とバージョン |
| [ブラウザ計測](03-browser-tracking.md) | data属性、表示条件、開始・停止、保存、ページ移動、応答の鮮度 |
| [判定方式](04-decision-engines.md) | Rules、Jev、候補の除外、見送り条件 |
| [セキュリティとプライバシー](05-security-and-privacy.md) | 収集範囲、キーの隔離、HTTP契約、容量と利用量の制限 |
| [出典と設計判断](08-references-and-decisions.md) | 一次資料、設計上の選択、未検証の条件 |

### 記録から案内までの流れ

```text
登録したIDを持つ表示・操作
    ↓
ブラウザで期間内の記録を集計（Snapshot）
    ↓
辞書の対応関係を使うRules / サーバーで辞書の説明を使うJev
    ↓
登録済みの候補ID、または見送り（Decision）
    ↓
利用サイトがカードやリンクとして表示
```

`auto / manual / disabled` で計測の開始方式を選べます。任意の入力文やDOM本文を集めず、計測中は登録したIDと数値を扱います。表示されたことを読了、料金を見たことを購入意思として断定しません。

## 検証結果と制約

現在の100候補の実装と測定条件は [100候補への拡張と評価](21-candidate-scale.md)を参照してください。合成の評価ケースでは案内と見送りを確認していますが、期待案はAI作成で人の確認前です。実サイトでの推薦品質や効果を保証する結果ではありません。

PlaywrightのChromium・Firefox・WebKitで検証しています。Safari製品版の基本デモとページ横断の記録は [Safari検証](16-safari-verification.md)にあります。100候補のSafari製品版での追加試験、iPhone/iPad実機、長時間の運用・負荷、Edge環境は未検証または未完です。

本番のJev接続に必要な共有利用制限は、利用側で実装する必要があります。APIやデータ形式の安定性、対応環境、容量の条件を確認したうえで導入してください。受け入れ条件と再現用コマンドは [テストガイド](06-implementation-and-tests.md)にまとめています。

## コードや文書に貢献する

[貢献ガイド](../CONTRIBUTING.md)から開発環境を準備し、[テストガイド](06-implementation-and-tests.md)で変更に応じた検査を選びます。作業の進め方は [変更作業のガイド](07-codex-handoff.md)を参照してください。

不具合や説明の不足は [GitHub Issues](https://github.com/blanket11/imicue/issues)で相談できます。再現手順には合成データを使い、APIキーやアカウント情報を含めないでください。

## 設計と検証の記録

次は各時点の実装・評価の記録です。過去の件数や判定ポリシーは、そのときの条件を示します。現在の利用手順には、上の利用ガイドとリファレンスを使ってください。

| 記録 | 内容 |
| --- | --- |
| [ローカル実装](09-local-implementation.md) | Core・Browser・Vanillaデモの初期検証 |
| [判定サーバー](10-server-implementation.md) | HTTP境界、モック、Jev接続の初期検証 |
| [配布形式とNext.js](11-distribution-and-next.md) | ESM・IIFE・静的出力の初期検証 |
| [公開準備と評価](12-release-preparation.md) | 配布前の検査とRulesの評価条件 |
| [ページ横断デモ](13-session-demo.md) | session保存、復元、撤回の検証 |
| [Jevの比較](14-jev-evaluation.md) | 実APIによる12シナリオの比較 |
| [観測の鮮度と実ブラウザ](15-freshness-and-live-browser.md) | 鮮度制限、実APIへのブラウザ接続 |
| [Safari製品版](16-safari-verification.md) | 基本デモ、ページ横断、Jev接続 |
| [推薦内容の確認表](17-recommendation-review.md) | 場面ごとの許容案と結果 |
| [単発操作の採点基準](18-jev-relevance-rubric.md) | 内容が一致する操作の評価 |
| [100候補の評価](21-candidate-scale.md) | 全件評価、容量による分割、閲覧デモ、実測結果 |

ライセンスは [Apache-2.0](../LICENSE) です。更新日: 2026-09-27。
