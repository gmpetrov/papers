import Link from 'next/link';
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${light ? 'light' : ''}`}
      aria-label="Papers home"
    >
      papers<span className="brand-dot">.</span>bot
    </Link>
  );
}
