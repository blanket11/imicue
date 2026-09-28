# Browser SDK — 計測・蓄積・ライフサイクル

## 1. TrackerのAPI

`createTracker()` は計測・保存・判定の開始と停止を管理する。Rulesはブラウザ内で動作し、`createRemoteEngine()` を指定すると判定サーバーへ接続できる。npmパッケージは未公開。[ローカルデモ](guides/local-demos.md)と[サーバー接続](guides/server-and-jev.md)で実際の使い方を確認できる。

```ts
const tracker = createTracker({
  definition,
  pageId: 'home',
  engine: createRulesEngine(), // サーバー接続ではcreateRemoteEngine()を指定
  collection: { mode: 'manual' }, // auto / manual / disabled
  storage: 'memory',         // 明示指定した場合だけ'session'
});

// 利用サイトの方針に従って開始する。manualは初期状態で観測しない。
tracker.start();

const unsubscribe = tracker.onDecision((decision) => {
  if (decision.type === 'recommend' && tracker.canDisplay(decision)) {
    // 利用サイトがcontentsを解決し、表示してよいタイミングで描画する。
  }
});

tracker.onSnapshot((snapshot) => { /* 開発用表示など */ });
tracker.track('demo-feature-used', { source: 'direct' });
tracker.recordOutcome('demo-pricing-guide', 'dismissed');
tracker.setPage('pricing-guide', { source: 'recommendation' });
tracker.getSnapshot();
tracker.evaluate(); // 任意の手動評価。制限・開始状態のチェックを迂回しない
tracker.stop();
tracker.reset();
unsubscribe();
tracker.destroy();
```

`track()`はkind=actionの登録済みIDだけを受ける。自由文字列、検索語、任意のmetadataオブジェクトは受け付けない。UIのクリックに意味を持たせたい場合も、固定のaction定義を登録する。

全購読APIは解除関数を返す。利用側コールバックが例外を投げても計測・本来のサイト操作を壊さない。エラーは安全な診断イベントへ変換する。

## 2. ライフサイクル

`collection.mode` は `auto / manual / disabled` を選べる。`auto` は初期化中に開始し、`manual` は `start()` を待つ。`disabled` は開始を抑止する。Imicueは同意UIと同意要否の判断を持たない。利用サイトの同意管理や設定画面から、開始・停止・削除を接続する。

`collection` 省略時は、後方互換のため `setConsent('granted')` → `start()` の条件を維持する。明示した `manual` は許可状態を前提にしない。モード比較と移行例は [開始モードのガイド](guides/collection.md)を参照する。

| 操作 | 必須の挙動 |
| --- | --- |
| createTracker | 定義とモードを検証。autoなら開始し、manual・disabled・省略時は待機 |
| setConsent('granted') | 許可を記録する。単独では監視を開始しない |
| start | 明示したauto/manualでは開始。disabledはno-op。省略時は従来の許可後のみ開始。二重登録しない |
| stop | 現在区間を確定し、監視・タイマー・通信を停止。許可と既存の期間内データは維持 |
| setConsent('denied') | stopに加え、メモリ・自分のstorage・抑制履歴を削除。通信応答も失効させる |
| reset | 自分の全データ・抑制履歴を削除し、進行中の評価を失効。許可と開始状態は維持 |
| destroy | stopしてメモリ・購読を解放。再利用不可。永続データ削除にはresetまたは同意撤回を使う |
| setPage | 旧ページの区間を確定。ページコンテキストを更新し旧応答を失効。直近の観測はウィンドウ内で維持 |

disabledでのstartはno-opと `collection_disabled` の診断通知。互換APIでの不許可もno-opと `consent_required` を通知し、再許可後は明示的なstartを要求する。destroy後の呼び出しはno-opと診断とし、サイトをクラッシュさせない。

ページやreset・同意撤回ごとに内部generationを増やす。遅れて返ってきたPromiseが古い状態を復活させないようにする。

## 3. HTMLからの登録

`data-imicue-signal="<id>"` を指定したkind=contentの要素だけを計測する。対象rootは初期値documentで、利用側が範囲を狭められるようにする。

`data-imicue-ignore` が自身または祖先にある要素は無視する。フォームや推薦UIを丸ごと計測対象外にする用途を想定する。

未知IDはdevelopmentで警告し、本番ではその要素を無視する。DOMから辞書を自動拡張しない。公開HTMLを書き換えてもモデル向け説明を差し込めない構造にする。

最初のscanとMutationObserverで追加・削除・対象属性変更に対応する。変更はまとめて処理し、不要な全ページ走査を毎イベントで行わない。明示的な `refresh()` も提供する。

v0.1の対象は通常の同一documentのDOM。iframe、Shadow DOM、仮想スクロールの自動識別は対応外。必要な意味的行動は手動track()で補う。

## 4. 表示の定義

既定値は次のとおり。条件どおりに計測することをテストしているが、すべてのサイトに最適な値とは主張しない。

| 項目 | 初期値 |
| --- | --- |
| 表示面積条件 | 以下のexposureRatioが0.5以上 |
| qualified view | 条件を連続2,000ms満たす |
| 再表示を別episodeにする非表示期間 | 1,000ms以上 |
| 無操作時の計測停止 | 最後の利用操作から60,000ms |
| 表示時間の区間確定 | 最大5,000ms間隔、および離脱・停止時 |
| 同時に監視するDOM要素 | 200まで |

IntersectionObserverの通常のintersectionRatioは対象全体に対する割合で、長いsectionでは50%に達しない場合がある。[参考資料 S7](08-references-and-decisions.md#s7)

このためImicueでは、root=viewport、rootMargin=0のv0.1において以下の値を使う。

```text
potentialArea = min(targetWidth, viewportWidth)
              * min(targetHeight, viewportHeight)

visibleArea = intersectionRect.width * intersectionRect.height

exposureRatio = clamp(visibleArea / potentialArea, 0, 1)
```

面積0や非有限値は非表示扱い。IOのthresholdは `0.5 * potentialArea / targetArea` に対応させ、要素サイズ・viewport変更時に再計算する。単にthreshold=0.5を固定して後から式だけ変える実装は不可。ResizeObserverと画面resizeを利用し、変更をまとめる。

高さ3,000px、同じ幅、高さ800pxのviewportで800px表示されればexposureRatio=1となる。短い要素はその要素の半分以上が見えることを要求する。

これは幾何学的な表示量の近似であり、他の要素に覆われていないことや読了を保証しない。特殊なCSS transform・視覚効果を完全に判定する機能は作らず、既知の制限を記載する。

## 5. 表示時間と回数

`document.visibilityState === 'visible'`、面積条件を満たす、無操作期限前、選んだ開始方式で計測開始済み、の全条件を満たす区間のみvisibleMsに加算する。

visibleMsには2秒未満の短い表示も記録する。qualifiedViewsは別指標であり、連続2秒に達した時だけ1増える。これらを混同しない。

一度qualifiedになったepisodeで、表示が続く間に2秒ごとに回数を増やさない。短い非表示が1秒未満なら同じepisodeとする。ただしqualifiedになる前の連続表示タイマーは非表示でリセットする。非表示が1秒以上続けば次は新しいepisodeとする。

無操作の起点はstart時点。pointerdown、keydown、scrollで期限だけを延長する。キーの値、座標、入力テキストは記録しない。scrollはpassiveかつ処理を間引き、モデル判定を直接呼ばない。長文を操作せず読む人も停止対象になるため、これは注意・読了の検出ではなく放置の影響を抑える近似と説明する。

経過時間はperformance.now()等の単調時計を抽象化して測定する。バックグラウンドや端末スリープから復帰した際に、timerの遅延をそのまま表示時間として加算しない。visibilitychange/pagehide/stopで区間を閉じる。

## 6. 二重計測の防止

親子に両方属性がある場合はleafの対象だけを観測し、属性付きの親を除外して警告する。異なるsourceが重複した場合も最も近い明示的なsourceを使う。

同一signalIdを複数箇所に付けた場合、同一sourceの表示時間は可視区間の和集合として数える。表示中要素数を足して時間を水増ししない。少なくとも1要素が条件を満たすかでepisodeを管理する。

クリックはイベント委譲し、closestの有効なsignalへ1回だけ割り当てる。通常のリンク遷移、フォーム送信、キーボード操作をpreventDefaultで妨げない。短時間の連打は同一signalで500msに1回までに抑える。

React Strict Modeのmount/cleanup/mountでもlistener・observerを重複させない。IIFEの重複初期化はrootとsiteIdをキーに検出し、既存インスタンスを再利用するか明確な診断を返す。

## 7. 蓄積と保存

メモリ内で、直近30分の表示区間と離散イベントを最大1,000件保持する。表示区間は最大5秒で区切り、ウィンドウ境界をまたぐ区間は重なった部分だけを集計する。古い記録を無限に積み上げない。容量で削除した場合はcoverage.truncated=trueにし、保持された最古の不足期間がウィンドウ外になるまでその状態を保つ。

ネットワークに内部イベント列を丸ごと送らない。[Snapshot](02-data-contracts.md#3-観測スナップショット) へ集約する。snapshotは読み取り専用で返し、利用側の変更が内部状態に影響しないようにする。

保存初期値はmemory。sessionStorageは明示的にstorage='session'とし、計測開始時に復元し、計測中に保存する。manualの開始前とdisabledでは読み書きしない。ただし明示したresetは自分の保存キーを削除する。localStorage、Cookie、永続ユーザーID、別タブ・別サイトへの同期は導入しない。

保存キーは `imicue:<siteId>:<definitionVersion>`。保存内容は固定形式で検証し、最後の活動から30分を超えるもの、壊れたJSON、未知バージョンは自分のキーだけ削除する。保存上限は128KiB。利用できない・容量超過の場合はmemoryにフォールバックする。同意状態・開始モード自体は保存せず、各ページの設定に従って開始する。

Date.now()は保存期限の判定だけに使う。未来時刻、不正な経過、時計巻き戻り等があれば安全側で保存データを捨てる。復元してもwindow外の履歴は取り込まない。

## 8. 推薦由来の行動

`data-imicue-source="recommendation"` を推薦UIの祖先に付けるか、setPage/trackのsourceで示す。デフォルトはdirect。

推薦リンクからのページ到達は利用側がsourceを引き継ぐ。参照元URL等から自動推定しない。v0.1ではページ遷移後の自動引き継ぎやクロスサイト連携は作らない。

推薦経由の記録はdirectと分離し、初期のRules/Jevの判断材料からは除外する。同じ推薦を繰り返して関心を自分で増幅させる循環を抑えるためである。UIのshown/clicked/dismissed/completedは別のoutcomeとして記録する。

## 9. 判定スケジューラーと競合

qualified view、クリック、action、5秒ごとの表示区間確定等でrevisionを更新する。snapshotを読み出すだけでrevisionを増やさない。setPage/reset/同意変更でも応答の有効性を失効させる。

意味のある変更後に最大1件を待機させ、評価開始間隔は最低15秒、同時実行数は1。連続変化は最新のsnapshotへまとめる。評価中に新しい観測が来ても無制限にリクエストを追加しない。無変更・タブ非表示・計測停止中では自動評価しない。互換APIで不許可にした場合も評価しない。

evaluate()も同じ制限を守る。結果は送信時のsnapshotId、revision、pageViewId、内部generationに対応させる。ページやrevisionが変わっていたら古い結果は破棄する。最新stateでの再評価は通常の間隔で行う。

表示時間の更新をミリ秒ごとにrevisionへ反映して、すべての応答が失効する設計にしない。確定区間単位の変更として扱う。

共通の最低観測量・候補除外はリクエスト前にも行い、実際の判定仕様は [Decision Engine](04-decision-engines.md) に従う。

## 10. 利用サイトの責任

SDKは表示を直接実行しない。デモでは結果を受けても、入力中のフォーム、モーダル表示、モバイルで主要操作を覆う状態ではポップアップを出さない。

表示直前に、計測の開始状態・ページ・候補・有効期限・抑制状態を再確認する。表示後にrecordOutcome(contentId, 'shown')、閉じたら'dismissed'を通知する。閉じる操作とキーボード操作ができ、フォーカスを強制移動しないUIにする。

SDKを使わなくてもサイトの本体は利用できること。推薦が失敗しても、既存のナビゲーションやCTAを隠さない。
