import Link from 'next/link';
import { DemoForm } from '../../components/demo-form';
export const metadata = { title: '資料請求 | PACELET' };
export default function Resources() {
  return <section className="form-page pale"><div className="container form-grid"><div data-imicue-signal="resources-detail"><p className="breadcrumb"><Link href="/">トップ</Link><span> / 資料請求</span></p><p className="eyebrow">PRODUCT GUIDE</p><h1>製品の全体像を、<br />ひとつの資料で。</h1><p>機能、プラン、共有設定をまとめた架空の製品資料です。フォームを操作すると、デモ内でサンプルを表示します。</p><div className="document-cover"><span>PACELET</span><h2>チームの進め方を、<br />整理する。</h2><div className="cover-lines" aria-hidden><i /><i /><i /></div><p>PRODUCT GUIDE / DEMO</p></div><h2 className="form-subheading">資料で確認できること</h2><ul><li>ボードと予定表の使い方</li><li>チームの規模に応じたプラン</li><li>プロジェクトの役割と共有範囲</li></ul></div><DemoForm kind="resources" /></div></section>;
}
