'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { TrackerSession } from './tracker-session';

const pages: Record<string, string> = { '/': 'home', '/guides/features': 'features-guide', '/guides/pricing': 'pricing-guide', '/guides/cases': 'cases-guide' };
export function DemoLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageId = pages[pathname.replace(/\/$/, '') || '/'];
  return pageId ? <TrackerSession pageId={pageId}>{children}</TrackerSession> : <main>{children}</main>;
}
