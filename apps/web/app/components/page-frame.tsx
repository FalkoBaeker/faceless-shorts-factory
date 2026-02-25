import Link from 'next/link';
import type { ReactNode } from 'react';

type AppPath = '/' | '/review' | '/job-status';

const navItems: Array<{ href: AppPath; label: string }> = [
  { href: '/', label: 'Wizard Start' },
  { href: '/review', label: 'Review' },
  { href: '/job-status', label: 'Job-Status' }
];

export function PageFrame({
  activePath,
  children
}: {
  activePath: AppPath;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="topbar" role="banner">
        <div className="brand-block">
          <p className="eyebrow">Faceless Shorts Factory</p>
          <p className="brand-title">Web App Vertical Slice</p>
        </div>

        <nav aria-label="Hauptnavigation" className="top-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-pill ${item.href === activePath ? 'active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {children}
    </div>
  );
}
