import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoLayout } from '../components/demo-layout';
import '../../vanilla/styles.css';
import './styles.css';

export const metadata = { title: 'Imicue Next.js静的デモ', description: '架空製品DemoContractで計測と判定を確認する静的出力デモ' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ja"><body><header><Link className="brand" href="/">DemoContract / Imicue</Link>
    <nav aria-label="ガイド"><Link href="/guides/features/">機能ガイド</Link><Link href="/guides/pricing/">料金ガイド</Link><Link href="/guides/cases/">事例ガイド</Link></nav>
  </header><DemoLayout>{children}</DemoLayout><footer>Next.js static exportのローカルデモ。判定を利用しなくても各ガイドを閲覧できます。</footer></body></html>;
}
