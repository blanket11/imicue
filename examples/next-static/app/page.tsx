import { SearchExample } from '../components/tracker-session';

export default function Home() {
  return <><section className="introduction"><p className="eyebrow">NEXT.JS STATIC EXPORT</p><h1>ページ遷移の計測を確認する</h1><p>架空製品DemoContractのサイトです。許可して計測を開始すると、表示と操作の記録を確認できます。</p></section>
    <section className="content-section" data-imicue-signal="demo-features"><h2>契約書を検索する</h2><p>あらかじめ用意した契約書名を表示する架空の機能例です。入力テキストは使いません。</p><SearchExample /></section>
    <section className="content-section" data-imicue-signal="demo-pricing"><h2>費用を考える</h2><p>利用人数、契約書の数、必要な機能を整理するための架空の説明です。</p></section>
    <section className="content-section" data-imicue-signal="demo-cases"><h2>チームで確認する</h2><p>更新予定の確認や、契約書の共有を想定した架空の利用場面です。</p></section>
  </>;
}
