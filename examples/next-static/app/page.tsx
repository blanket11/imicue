import { SearchExample } from '../components/tracker-session';

export default function Home() {
  return <><section className="introduction"><p className="eyebrow">NEXT.JS STATIC EXPORT</p><h1>ページ遷移の計測を確認する</h1><p>読書ノートアプリを題材にした架空のサイトです。許可して計測を開始すると、表示と操作の記録を確認できます。</p></section>
    <section className="content-section" data-imicue-signal="demo-features"><h2>本や読書メモを検索する</h2><p>あらかじめ用意した本の題名と読書メモを表示する架空の機能例です。入力テキストは使いません。</p><SearchExample /></section>
    <section className="content-section" data-imicue-signal="demo-pricing"><h2>利用プランを比べる</h2><p>読書記録の保存数や端末間同期を整理するための架空の説明です。</p></section>
    <section className="content-section" data-imicue-signal="demo-cases"><h2>読書記録を整理する</h2><p>読みかけと読み終えた本を記録し、続きを読む本を見つける架空の使い方です。</p></section>
  </>;
}
