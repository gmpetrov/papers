import Link from 'next/link';
import styles from './public-page.module.css';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Brand } from './brand';

export function PublicNav() {
  return (
    <nav className={`site-nav ${styles.nav}`} aria-label="Main navigation">
      <Brand />
      <div className="nav-links">
        {/* <Link href="/email">Email</Link> */}
        {/* <Link href="/phone">Phone</Link> */}
        {/* <Link href="/integrations">Integrations</Link> */}
        <Link href="/pricing">Pricing</Link>
        <Link href="/docs">Docs</Link>
      </div>
      <div className="nav-actions">
        <Link className="button small" href="/login">
          Sign In <ArrowRight size={15} />
        </Link>
      </div>
    </nav>
  );
}
export function PublicPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={`landing ${styles.page}`}>
      <PublicNav />
      <main className="public-content">
        <header className="public-heading">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        {children}
      </main>
      <footer>
        <Brand />
        <span>Email and phone infrastructure for agents.</span>
        <Link href="/docs">Developer docs</Link>
      </footer>
    </div>
  );
}
