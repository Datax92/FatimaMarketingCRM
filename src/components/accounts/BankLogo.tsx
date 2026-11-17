import { bankFor, colourFor } from "@/lib/banks";

/** An account's badge: the bank's logo or brand-coloured mark, else the name's initials. */
export function BankLogo({ name, size = 40 }: { name: string; size?: number }) {
  const bank = bankFor(name);
  const radius = Math.round(size * 0.26);

  if (bank?.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/banks/${bank.logo}`} alt={bank.name} width={size} height={size} className="fm-logo" style={{ borderRadius: radius }} />
    );
  }

  const bg = bank?.bg ?? colourFor(name);
  const fg = bank?.fg ?? "#fff";
  const mark = bank?.mark ?? initials(name);
  const font = mark.length >= 3 ? size * 0.3 : mark.length === 2 ? size * 0.36 : size * 0.46;

  return (
    <span
      className="fm-logo"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(145deg, ${bg} 0%, ${bg} 55%, color-mix(in srgb, ${bg} 78%, #000) 100%)`,
        color: fg,
        fontSize: font,
      }}
    >
      {bank?.kind === "cash" ? <CashGlyph size={size * 0.56} /> : mark}
      {bank?.accent && <i style={{ background: bank.accent }} />}
    </span>
  );
}

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

function CashGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  );
}
