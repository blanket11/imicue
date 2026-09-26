import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CompleteGuide } from '../../../components/tracker-session';

const guides: Record<string, { title: string; body: string }> = {
  features: { title: '機能ガイド', body: '検索例では固定の契約書名を表示します。検索と一覧表示を想定した架空の機能で、実際の契約書は扱いません。' },
  pricing: { title: '料金ガイド', body: '費用の検討では、利用人数、契約書の数、必要な機能を整理します。このデモでは実際の料金や見積もりを提示しません。' },
  cases: { title: '事例ガイド', body: '契約書を探し、更新予定を確認し、チームへ共有する場面を想定しています。実在する企業の導入事例ではありません。' },
};
export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(guides).map((topic) => ({ topic }));
export default async function Guide({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const guide = guides[topic];
  if (!guide) notFound();
  return <article className="content-section" data-imicue-signal={`demo-${topic}-guide-view`}><h1>{guide.title}</h1><p>{guide.body}</p><CompleteGuide /><p><Link href="/">製品の紹介に戻る</Link></p></article>;
}
