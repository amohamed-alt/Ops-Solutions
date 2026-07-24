import Link from 'next/link';

import '../../app/legal.css';

const NAVIGATION = [
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/security', 'Security'],
  ['/support', 'Support'],
  ['/data-deletion', 'Data deletion']
];

export function PublicPolicyLayout({ eyebrow, title, summary, updated = '24 July 2026', sections = [], children }) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link className="legal-brand" href="/">
          <span className="legal-brand-mark" aria-hidden="true">OS</span>
          <span>Ops Solutions</span>
        </Link>
        <nav className="legal-nav" aria-label="Public information">
          {NAVIGATION.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
      </header>
      <main className="legal-main">
        <section className="legal-hero">
          <p className="legal-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-summary">{summary}</p>
          <div className="legal-meta">
            <span className="legal-pill">Effective {updated}</span>
            <span className="legal-pill">Ops Solutions</span>
            <span className="legal-pill">HubSpot analytics platform</span>
          </div>
        </section>
        <div className="legal-grid">
          <div className="legal-content">
            {children}
            {sections.map((section) => (
              <section className="legal-section" id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                {section.content}
              </section>
            ))}
          </div>
          <aside className="legal-aside">
            <h2>On this page</h2>
            {sections.map((section) => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}
            <Link href="/support">Contact support</Link>
          </aside>
        </div>
      </main>
      <footer className="legal-footer">
        <div className="legal-footer-inner">
          <span>© 2026 Ops Solutions. Revenue intelligence built around customer-controlled HubSpot data.</span>
          <div className="legal-footer-links">
            {NAVIGATION.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}
          </div>
        </div>
      </footer>
    </div>
  );
}
