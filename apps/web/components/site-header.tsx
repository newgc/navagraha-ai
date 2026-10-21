import Link from 'next/link';
import type { ReactNode } from 'react';
import { Emblem } from './emblem';

/** The customer-facing header: brand, the main links and the primary call to action (D-03). */
export function SiteHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="brand-lockup" aria-label="Navagraha AI — home">
          <Emblem size={36} />
          <span className="brand-name">
            Navagraha <span className="brand-ai">AI</span>
          </span>
        </Link>
        <nav aria-label="Main">
          <Link href="/#how">How it works</Link>
          <Link href="/#temples">The nine temples</Link>
          <Link href="/trips">My trips</Link>
        </nav>
        {right ?? (
          <Link href="/plan" className="cta cta-small">
            Plan My Pilgrimage
          </Link>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="brand-lockup">
          <Emblem size={28} />
          <span className="brand-name">
            Navagraha <span className="brand-ai">AI</span>
          </span>
        </div>
        <p className="small">
          Your AI Pilgrimage Manager for the nine Navagraha temples around Kumbakonam, Tamil Nadu.
        </p>
        <nav aria-label="Footer" className="small">
          <Link href="/plan">Plan My Pilgrimage</Link>
          <Link href="/trips">My trips</Link>
          <Link href="/sign-in">Staff sign in</Link>
        </nav>
        <p className="small muted">© {new Date().getFullYear()} Navagraha AI</p>
      </div>
    </footer>
  );
}

/** Customer pages share the header and footer around their content. */
export function SitePage({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="site">
      <SiteHeader right={right} />
      {children}
      <SiteFooter />
    </div>
  );
}
