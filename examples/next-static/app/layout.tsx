import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoLayout } from '../components/demo-layout';
import '../../vanilla/styles.css';
import './styles.css';

export const metadata = { title: 'Imicue Next.js静的デモ', description: '読書ノートアプリを題材に計測と判定を確認する静的出力デモ' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ja"><body><header><Link className="brand" href="/">読書ノート / Imicue</Link>
    <nav aria-label="ガイド"><Link href="/guides/features/">検索ガイド</Link><Link href="/guides/pricing/">利用プランガイド</Link><Link href="/guides/cases/">記録の整理ガイド</Link></nav>
  </header><DemoLayout>{children}</DemoLayout><footer>Next.js static exportのローカルデモ。判定を利用しなくても各ガイドを閲覧できます。</footer></body></html>;
}
