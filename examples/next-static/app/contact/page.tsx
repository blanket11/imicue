import Link from 'next/link';
import { DemoForm } from '../../components/demo-form';
export const metadata = { title: 'お問い合わせ | PACELET' };
export default function Contact() {
  return <section className="form-page pale"><div className="container form-grid"><div data-imicue-signal="contact-detail"><p className="breadcrumb"><Link href="/">トップ</Link><span> / お問い合わせ</span></p><p className="eyebrow">CONTACT</p><h1>導入について<br />相談する。</h1><p>チームの状況に合わせた導入を想定した、架空のフォームです。問い合わせの完了表示まで試せます。</p><h2 className="form-subheading">相談項目の例</h2><div className="consult-topics">{[['運用の整理', '担当と確認の流れを整理して、チームでの進め方を考える。'], ['移行の進め方', '今使っているタスクの分け方を確認して、移す順序を決める。'], ['チームごとの権限', '更新する人と確認する人を分けて、共有範囲を整理する。']].map(([title, body], i) => <div key={title}><span className="role-icon" aria-hidden>0{i + 1}</span><div><h3>{title}</h3><p>{body}</p></div></div>)}</div></div><DemoForm kind="contact" /></div></section>;
}
