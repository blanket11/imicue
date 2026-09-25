# Imicue — 開発仕様書

**状態: v0.1 Draft / 実装前**  
作成・外部資料確認: 2026-09-26

Imicueは、WebサイトやWebアプリの行動シグナルに辞書で意味を与え、ルールやAIによる判断につなげるヘッドレスなOSSライブラリです。ヘッドレスとは、表示UIをライブラリ本体から分離し、利用サイトが自由に結果を使えることを指します。

このフォルダは実装者とCodexへの引き継ぎ用です。仕様書追加時点では実装コード、実行用script、公開済みnpmパッケージはありません。コード例はこれから実装するAPIの設計案です。

## 最初に読むもの

まず [目的と構成](01-product-and-architecture.md)、次に [データ契約](02-data-contracts.md) を読み、担当領域の詳細と [受け入れテスト](06-implementation-and-tests.md) を確認してください。初回の実装依頼では01〜08を通して読みます。

| ファイル | 内容 |
| --- | --- |
| [01-product-and-architecture.md](01-product-and-architecture.md) | 目的、v0.1の範囲、Core/Browser/Server、SSGの境界 |
| [02-data-contracts.md](02-data-contracts.md) | シグナル辞書、意味の説明、観測・候補・出力の型、バージョン |
| [03-browser-tracking.md](03-browser-tracking.md) | data属性、計測条件、重複防止、同意、保存、ページ遷移、応答の鮮度 |
| [04-decision-engines.md](04-decision-engines.md) | Rulesの比較基準、Jev接続、採点基準、候補除外、見送り |
| [05-security-and-privacy.md](05-security-and-privacy.md) | キー隔離、収集しない情報、HTTP契約、容量・課金制限 |
| [06-implementation-and-tests.md](06-implementation-and-tests.md) | M0〜M5の実装順序と必須テスト、実API確認の分離 |
| [07-codex-handoff.md](07-codex-handoff.md) | Codexにそのまま渡す依頼文と、後続段階の依頼文 |
| [08-references-and-decisions.md](08-references-and-decisions.md) | 一次資料、設計判断、未検証事項、後で決めること |

## 仕組みの要約

```text
<section data-imicue-signal="demo-pricing">
        ↓
ブラウザ: 表示・操作を期間限定で集計
        ↓
辞書: demo-pricingは何の製品の何についての内容かを説明
        ↓
Rules（ローカル） または 判定サーバー → Jev
        ↓
候補評価 + 推薦するcontentId / 見送り
        ↓
利用サイトが案内カード・インライン表示などに利用
```

HTMLに埋め込むのは登録済みIDです。辞書の参照はコードで行い、Jevに不透明なIDや巨大な辞書を解読させません。関心推定を必須の中間段階にはせず、次に案内する候補の関連性を直接評価できます。

## 今回の実装着手点

最初はM0〜M2、すなわち基盤・Core・Browser・Vanillaデモです。APIキーなしで計測とルール判定を確認できる状態を先に作ります。

その後にM3のJev接続、M4の配布用ビルドとNext.js static export例、M5の公開準備を進めます。キーがなくてもローカル版の実装は進められます。

最初の依頼文は [Codexへの引き継ぎ](07-codex-handoff.md#2-最初の依頼文ローカルで動く最小版) にあります。別の環境へ渡す場合も、このリポジトリ内のdocsを読める状態にしてから依頼してください。

## 変更してはいけない境界

表示されたことを読了と断定せず、料金を見たことを購入意思の事実として扱いません。スコアと確率とconfidenceを混同しません。

初期状態では観測・保存・判定通信を始めません。APIキーをブラウザへ出さず、任意のユーザー入力やDOM本文を収集しません。

AIは承認済み候補の評価に使い、自由なURL・HTML・コードを返して実行させません。見送り・障害時もサイト本来の機能を残します。

勤務先のコード・非公開設定・実データを使いません。実装依頼だけでnpm公開、デプロイ、有料API試験、既存サイトへの導入、Issue/Project変更を行いません。

## 仕様の確実性と優先順位

構造・安全条件・データの意味は実装の基準です。一方、2秒、30分、採点の重み、閾値、容量、遅延、サイズなどは、再現可能な出発点を作るための未検証の初期値です。効果や最適性を実証した値ではありません。

詳細な契約は02〜05、検証条件は06を参照します。要約と詳細に食い違いを見つけたら黙って片方を捨てず、理由を記録して整合させてください。特に05の安全条件を利便性のために緩めないでください。

外部サービスの最新仕様が変わっていたら、08の資料を再確認し、影響する契約とテストを一緒に更新します。未検証の外部APIを呼べたことにしないでください。

## このドキュメント追加の範囲

追加対象はdocs配下のMarkdownのみです。既存のルートREADMEとApache-2.0 LICENSEは維持し、実装コード、Issue、GitHub Project、公開設定は変更しません。

[Repository](https://github.com/blanket11/imicue) / [Development Project](https://github.com/users/blanket11/projects/1/views/1) / [License](../LICENSE)
