import Link from 'next/link';
import { notFound } from 'next/navigation';
const routes: Record<string, [string, string]> = { features: ['/features/', '機能'], pricing: ['/#pricing', '料金'], cases: ['/cases/', '導入事例'] };
export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(routes).map((topic) => ({ topic }));
export default async function Guide({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  const route = routes[topic];
  if (!route) notFound();
  return <div className="container page-intro"><h1>デモをリニューアルしました</h1><p>PACELETの製品サイトで、閲覧に応じた案内を試せます。</p><Link className="button" href={route[0]}>{route[1]}を見る →</Link></div>;
}
