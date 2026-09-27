import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompleteGuide } from '../../../components/tracker-session';

const guides: Record<string, { title: string; body: string }> = {
  features: { title: '読書メモの検索ガイド', body: '検索例では固定の本の題名とメモを表示します。題名やメモの語句から記録を探す架空の機能で、入力テキストは使いません。' },
  pricing: { title: '利用プランガイド', body: 'プランの検討では、読書記録の保存数や端末間同期、メモの出力方法を整理します。このデモでは実際の料金や申し込みを提示しません。' },
  cases: { title: '読書記録の整理ガイド', body: '読みたい本、読んでいる本、読み終えた本を分け、続きを読む本を見つける架空の使い方です。' },
};
export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(guides).map((topic) => ({ topic }));
export default async function Guide({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const guide = guides[topic];
  if (!guide) notFound();
  return <article className="content-section" data-imicue-signal={`demo-${topic}-guide-view`}><h1>{guide.title}</h1><p>{guide.body}</p><CompleteGuide /><p><Link href="/">製品の紹介に戻る</Link></p></article>;
}
