import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoLayout } from '../components/demo-layout';
import './styles.css';

export const metadata = { title: 'PACELET | Imicue 製品サイトデモ', description: '架空のチーム向け進行管理サービスで、閲覧に応じたImicueの案内を試せるデモ' };
const nav = [['/features/', '機能'], ['/cases/', '導入事例'], ['/#pricing', '料金'], ['/resources/', '資料請求'], ['/contact/', 'お問い合わせ']];
function Brand() { return <Link className="brand" href="/" aria-label="PACELET トップ"><span className="brand-mark" aria-hidden>P</span>PACELET</Link>; }
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ja"><body><a className="skip-link" href="#main">本文へ移動</a><div className="demo-notice">Imicue DEMO <span>架空の製品サイトです。フォームは外部に送信しません。</span></div><header className="site-header"><div className="container header-inner"><Brand /><nav aria-label="メインナビゲーション">{nav.map(([href, label]) => <Link href={href!} key={href}>{label}</Link>)}</nav></div></header><DemoLayout>{children}</DemoLayout><footer className="site-footer"><div className="container"><div className="footer-top"><Brand /><nav aria-label="フッターナビゲーション">{nav.map(([href, label]) => <Link href={href!} key={href}>{label}</Link>)}</nav></div><p>PACELETはImicueの動作を確かめるための架空の製品です。</p><p className="small">登録したセクションの表示・操作をこのタブに30分間記録します。計測の停止と記録の削除は左下のImicue Debugから行えます。</p></div></footer></body></html>;
}
