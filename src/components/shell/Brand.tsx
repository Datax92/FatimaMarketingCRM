import { COMPANY } from '@/lib/brand';

/** The Fatima Marketing mark: an "F" whose arms are a rising signal, drawn in the theme's colours. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={COMPANY}>
      <rect x="2" y="2" width="44" height="44" rx="11" fill="var(--brand)" />
      <path d="M15 37V12h18" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 24.5h11" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" />
      <path d="M27 36l5-6 4 3 5-8" fill="none" stroke="var(--hl)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark and name side by side, for the sign-in screen. */
export function BrandLockup({ size = 44 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
      <BrandMark size={size} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05, textAlign: 'left' }}>
        <b style={{ fontSize: size * 0.5, fontWeight: 700, letterSpacing: '-.02em', color: 'var(--ink)' }}>Fatima</b>
        <small style={{ fontSize: size * 0.27, fontWeight: 700, letterSpacing: '.18em', color: 'var(--brand-2)', textTransform: 'uppercase' }}>
          Marketing
        </small>
      </span>
    </span>
  );
}
