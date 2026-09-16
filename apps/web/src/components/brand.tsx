import Link from "next/link";
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${light ? "light" : ""}`}
      aria-label="Papers home"
    >
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      papers<span className="brand-dot">.</span>
    </Link>
  );
}
