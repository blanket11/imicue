'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { TrackerSession } from './tracker-session';
const pages: Record<string, string> = { '/': 'home', '/features': 'features', '/cases': 'cases', '/resources': 'resources', '/contact': 'contact' };
export function DemoLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageId = pages[pathname.replace(/\/$/, '') || '/'];
  return pageId ? <TrackerSession pageId={pageId}>{children}</TrackerSession> : <main id="main" tabIndex={-1}>{children}</main>;
}
