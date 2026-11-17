/**
 * The "nothing selected yet" pane, shared by the leads workspace and the Data
 * Bank folder workspace.
 *
 * Extracted rather than copied so the two screens cannot drift: they are the
 * same two-pane product, and a second hand-drawn illustration would be one
 * more thing to keep in sync every time the teal ramp moves.
 *
 * Drawn inline in the pane's own tones with a transparent background, so there
 * is no image edge or white box sitting on the gradient.
 */

export function WorkspaceEmpty({
  label,
  hint,
}: {
  /** The one-line prompt under the illustration. */
  label: string;
  /** Optional second line, for a screen that needs to explain itself. */
  hint?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-linear-to-b from-[var(--brand-wash)] to-[var(--rule)] p-10 text-center">
      <svg
        viewBox="0 0 520 300"
        className="animate-lead-empty h-auto w-full max-w-[520px]"
        fill="none"
        role="img"
        aria-label="An illustration of a list with a cursor selecting a row"
      >
        <ellipse cx="260" cy="252" rx="176" ry="16" fill="var(--brand-2)" opacity="0.09" />
        <circle cx="392" cy="74" r="58" fill="var(--brand-2)" opacity="0.07" />
        <circle cx="118" cy="196" r="40" fill="var(--brand-2)" opacity="0.06" />
        <rect x="132" y="40" width="256" height="196" rx="12" fill="#ffffff" opacity="0.6" />
        <rect x="132" y="40" width="256" height="196" rx="12" stroke="var(--brand-edge)" strokeWidth="1.5" />
        <path d="M132 66h256" stroke="var(--brand-edge)" strokeWidth="1.5" />
        <circle cx="150" cy="53" r="3.6" fill="var(--rule-2)" />
        <circle cx="163" cy="53" r="3.6" fill="var(--rule-2)" />
        <circle cx="176" cy="53" r="3.6" fill="var(--rule-2)" />
        <rect x="150" y="84" width="98" height="9" rx="4.5" fill="var(--brand-2)" opacity="0.5" />
        <rect x="150" y="104" width="60" height="7" rx="3.5" fill="var(--brand-2)" opacity="0.24" />
        <rect x="150" y="132" width="220" height="30" rx="8" fill="var(--brand-2)" opacity="0.1" />
        <circle cx="170" cy="147" r="9" stroke="var(--brand-2)" strokeWidth="1.6" opacity="0.55" />
        <rect x="188" y="141" width="86" height="6" rx="3" fill="var(--brand-2)" opacity="0.4" />
        <rect x="188" y="152" width="52" height="5" rx="2.5" fill="var(--brand-2)" opacity="0.25" />
        <rect x="150" y="172" width="220" height="30" rx="8" fill="var(--brand-2)" opacity="0.06" />
        <circle cx="170" cy="187" r="9" stroke="var(--brand-2)" strokeWidth="1.6" opacity="0.35" />
        <rect x="188" y="181" width="70" height="6" rx="3" fill="var(--brand-2)" opacity="0.26" />
        <rect x="188" y="192" width="44" height="5" rx="2.5" fill="var(--brand-2)" opacity="0.18" />
        <path d="M300 176l26 12-11 4-4 11-11-27z" fill="var(--brand)" opacity="0.75" />
        <path
          d="M404 150c0-10 8-18 18-18M436 106c-8 0-14-6-14-14"
          stroke="var(--brand-2)"
          strokeWidth="1.6"
          opacity="0.4"
          strokeLinecap="round"
        />
        <circle cx="96" cy="96" r="5" fill="var(--brand-2)" opacity="0.25" />
        <circle cx="440" cy="204" r="7" fill="var(--brand-2)" opacity="0.18" />
      </svg>
      <div className="-mt-4">
        <p className="text-[17px] font-light text-[var(--ink-2)]">{label}</p>
        {hint && <p className="mx-auto mt-2 max-w-[380px] text-[13px] text-[var(--ink-3)]">{hint}</p>}
      </div>
    </div>
  );
}
