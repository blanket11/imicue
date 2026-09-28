# 参考資料・設計判断・未検証事項

初回確認日: 2026-09-26。追加の確認は該当箇所に日付を示す。外部サービスのAPI・モデル・制限は変化するため、依存の更新や新しい環境への導入時に再確認する。以下は公式資料・一次資料に基づく技術上の前提と、Imicue自身の設計判断を区別して記録したもの。

## S1

**TypeSafe — Introduction / Choice**

[Introduction](https://docs.typesafe.ai/introduction) / [Choice](https://docs.typesafe.ai/primitives/choice)

Jevはstateと型付き質問を受け取り、構造化した結果を返す。Choiceでは選択肢の説明を設定でき、質問ごとに独立した評価を行う。questionIdはアプリ側の対応付け用であり、質問の意味を伝える本文の代わりにはならない。

Imicueでは、各候補のdescriptionを対応する質問に明示し、辞書をコードで解決してから渡す。JevがブラウザやDOMを直接監視する設計にはしない。

## S2

**TypeSafe — Score**

[Score](https://docs.typesafe.ai/primitives/score)

Scoreは説明を持つ段階ごとの確率で重み付けした期待値を返す。4段階なら0〜3で、小数も含む。Imicue内の0〜1値は順位付け用に正規化したもので、人物の関心や購入の確率ではない。サーバー実装時に公式仕様とSDKのScoreResponse型を確認し、小数のスコアを受け入れる検証に修正した。

## S3

**TypeSafe — Confidence**

[Confidence](https://docs.typesafe.ai/confidence)

Choice/Scoreのconfidenceは回答の確率分布から算出される指標であり、Noulには同じconfidence項目がない。実運用の正答率を保証するものとして扱わず、Rulesに同名の架空指標を付けない。

## S4

**TypeSafe — Models**

[Models](https://docs.typesafe.ai/models)

確認時点ではjev-1.13.0が掲載されている。英語が主な学習言語で、CJKを含む他言語で同等の品質とはしていない。可変エイリアスは実装変更なしに参照モデルが変わり得る。

Imicueでは英語のmodelDescriptionを任意に用意できるようにし、言語別の比較を行う。モデルIDを固定し、返された実際のIDも確認する。利用料金・応答速度・レート制限を本仕様の固定前提にはしない。

## S5

**TypeSafe — JavaScript SDK / Client Config**

[JavaScript SDK](https://docs.typesafe.ai/sdk/javascript/) / [TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig)

SDKは@typesafe-ai/sdk、環境変数はTYPESAFE_API_KEY。ブラウザ利用を許可する設定はキーの露出につながる。timeout、retry、ログの設定は実装時に現行の型を確認する。

ImicueはSDKをserver内に隔離する。既定のリトライ任せにせず、入力本文がログに出ないことを確認する。SDKの最小Node要件と、現在サポート中のNodeを選ぶ判断は別である。

サーバー実装時の確認（2026-09-26）: `@typesafe-ai/sdk@0.6.0` を固定し、同梱の型と公式資料で `score(instructions, criteria)`、`TypeSafeClient.systemOne` を確認した。`retry: { maxRetries: 0 }`、`logLevel: 'off'`、固定baseURLとモデル `jev-1.13.0` を明示している。[RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy) も参照。モックfetchで呼び出し回数とログ出力を検証した。その後の実API確認は[初回比較](14-jev-evaluation.md)と[100候補の評価](21-candidate-scale.md)に記録している。

## S6

**Next.js — Static Exports**

[Static Exports](https://nextjs.org/docs/app/guides/static-exports)

静的エクスポートでは動的POST処理を提供できない。Client Componentもビルド時に事前レンダリングされるため、ブラウザAPIへのアクセスを実行時に限定する必要がある。

ImicueのJev接続は別のendpoint。ローカルRulesは静的ファイルだけで動く構成にする。

配布・Next.js実装時の確認（2026-09-26）: Next.js 16.3.6、React/React DOM 19.3.0を固定した。`output: 'export'`、`trailingSlash: true` で生成したoutを静的サーバーから配信する。React Strict Modeのeffect再実行は開発時の検査なので、静的出力のE2Eとは別に実Reactを使う統合試験で確認する。[Next.jsのStrict Mode設定](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactStrictMode)・[React StrictMode](https://react.dev/reference/react/StrictMode) を参照。

配布は [Vite Library Mode](https://vite.dev/guide/build.html#library-mode) と [TypeScript declaration](https://www.typescriptlang.org/tsconfig/declaration.html) を参照した。通常のpackage importは生成済みESMと型定義を解決し、リポジトリ内の開発時だけ明示した条件でソースを参照する。[Node.js Conditional Exports](https://nodejs.org/api/packages.html#conditional-exports) に従う構成で、外部利用を模した型検査ではソースをコピーせずに確認した。

## S7

**MDN — Intersection Observerでの表示時間計測**

[Timing element visibility](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API/Timing_element_visibility)

交差状態と、タブが表示されているかは別に扱う。ブラウザ上で領域に入ったことを読了と同一視しない。

Imicueの長いsection対応の面積計算、無操作タイムアウト、回数のepisode定義は独自の設計判断であり、MDNの推奨値ではない。

## S8

**TypeSafe — Jev 1.13 jaggedness**

[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

間接参照、数値や日時の厳密な処理、無関係な大きいstate、敵対的なテキスト等について限界が説明されている。

Imicueでは、辞書の参照、集計、候補の期限・製品チェックをコードに置き、必要な説明だけを渡す。型が正しいことを根拠に意味的誤判断やprompt injectionがないとは主張しない。

## S9

**OWASP — REST Security Cheat Sheet**

[REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)

入力・メソッド・容量・利用制限、CORS、応答の扱いなどを設計するための一次資料。CORSや公開siteIdを本人確認の代わりに使わない。

Imicueの受信32KiB、Jev要求64KiB、30回/分、100回/日といった数値は独自の制限であって、OWASPの指定値や本番適正値ではない。

## S10

**Node.js — Releases**

[Node.js Releases](https://nodejs.org/en/about/previous-releases)

実装時にサポート状況を確認して実行環境を選ぶ。2026-09-26の確認では24系と22系がLTSとして掲載されている。リポジトリはNode.js 24.14.0とnpm 11.9.0に固定している。

## S11

**OpenAI — Codex / AGENTS.md**

[AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/) / [Introducing Codex](https://openai.com/index/introducing-codex/)

Codex向けのリポジトリ指示と、作業範囲・テスト手順の整理に関する資料。ImicueではAGENTS.mdの存在を確認したうえで、依頼文からdocsの読み取りを明示する。docsがあるだけで実装の正しさを保証できるとは考えない。

## 設計判断の記録

| ID | 採用した判断 | 理由 |
| --- | --- | --- |
| ADR-001 | HTMLはdata-imicue-signalの固定ID、意味は辞書 | 内容を曖昧な短いタグだけに依存させず、編集者の導入作業も小さくする |
| ADR-002 | 観測・辞書・推定・出力を分離 | 表示を購買意思に変換する飛躍やモデル依存を防ぐ |
| ADR-003 | 候補の関連性を直接評価できる | 関心推定→推薦という必須の二段階で情報を失わない |
| ADR-004 | Rulesを最初に用意 | キーなしで試せ、Jevの意味的な付加価値を比較できる |
| ADR-005 | Core / Browser / Serverの3責務 | ReactやJevに本体を結び付けず、初期のパッケージ細分化も避ける |
| ADR-006 | memory既定、開始方式はサイト側で選択 | auto/manual/disabledを正式に扱い、省略時だけは従来の許可条件を維持する。[開始モード](guides/collection.md)を参照 |
| ADR-007 | 推薦由来の行動を分ける | 自分の案内で生じた行動を自然な関心として自己増幅させない |
| ADR-008 | 固定候補IDとabstainを返す | UI・URL・文章をAIに自由生成させず、利用サイトが実行を管理する |
| ADR-009 | 初期準備では仕様文書を先に整備 | 実装・Issue管理・サービス公開を別作業として進めた。当時の順序を表す判断であり、現在は実装と紹介サイトも公開している |
| ADR-010 | CDNは静的SDK配布、キーは別server | 埋め込み導入の容易さと秘密情報の隔離を両立する |
| ADR-011 | 100候補を全件Scoreで評価し、容量で分割 | 意味による事前選抜の漏れを避け、全候補の結果検証を維持する。共通stateから候補の重複を除く |
| ADR-012 | 分割計画のquotaと外部試行の同時数を分離 | 1判定内の複数API呼び出しでも、課金・並列数の上限を迂回させない |

2026-09-27に [Models](https://docs.typesafe.ai/models)、[API](https://docs.typesafe.ai/api)、[Score](https://docs.typesafe.ai/primitives/score)、[Choice](https://docs.typesafe.ai/primitives/choice) とSDK 0.6.0を再確認した。jev-1.13.0の公式入力制限は全質問とstateで64k tokens、stateと最長質問で32k tokens。Choice最大255択、Scoreは2〜10段階。Imicueのbyte上限とは区別する。質問数の独立した数値上限・送出前の公式token計数手段は、確認した資料では確認できなかった。

[182件のSkill選択例](https://docs.typesafe.ai/cookbooks/skill_suggestion)や[再順位付け例](https://docs.typesafe.ai/cookbooks/rerank_typesafe)は設計比較の参考にした。別用途の結果をImicueの日本語100候補の性能保証へ転用しない。方式比較と実測の条件は [評価記録](21-candidate-scale.md) に残す。

## 実装して比較する必要があるもの

合成データでの推薦・遅延・入力量・料金推計と配布物サイズは [100候補の評価記録](21-candidate-scale.md) に残した。人による推薦品質の確認、日本語と英語の差、閾値・重み・表示時間の適切さ、長いsectionでの使い勝手、Rulesに対するJevの効果、実環境での継続的な負荷は引き続き検証が必要である。

UIを加えたときの回遊やCVへの影響は、このライブラリの技術的完成と分けて評価する。

## 今後の検討事項

npmスコープ・パッケージ公開名、SDKを配るCDNの実URL、WordPressプラグイン、Cloud/Hosted版の運用・料金、長期的なガバナンスは未確定。[紹介サイト](https://imicue.push.tokyo/)は公開済みだが、npmパッケージと本番用のJev判定サービスは公開していない。

Cloudflare Workers等のEdge環境、他フレームワーク専用SDK、iframe/Shadow DOMの自動計測、複数サイトを横断する識別はv0.1で対応済みと記載しない。

## 変更するときのルール

2026-09-26のローカル版実装ではNode 24系のLTS状態と開発ツールの公式資料・依存条件を確認した。採用バージョンと理由は [ローカル版の実装メモ](09-local-implementation.md#依存関係の確認資料) に記録している。JevとNext.jsの確認内容は本書のS5・S6に記録している。

新しい一次資料で前提が変わった場合は、確認日、変わった事実、影響する仕様、テストを同じ変更で記録する。プロバイダーの宣伝上の数値をImicueの性能保証に置き換えない。

設計上の暫定値は「未検証の初期値」としたまま実装・比較し、根拠が得られた時にpolicyVersionと評価結果を更新する。
