// The viewer's icon set: hand-rolled inline SVGs, all stroke="currentColor" so
// they inherit the button's ink/accent. Tray icons live on a 16x16 grid, the narrow
// pick-mode glyphs on 14x10. One module so the popup, trays and flyouts share glyphs
// (the conformers icon doubles as the "show conformers" action mark).

export function DensityIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2.6" />
      <circle cx="8" cy="8" r="6" opacity="0.5" />
    </svg>
  );
}

// two offset stick traces sharing endpoints: a residue split into alternate conformers
export function ConformersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12 L6 8 L10 10 L14 5" />
      <path d="M2 12 L6 12.5 L10 14 L14 5" opacity="0.45" />
      <circle cx="2" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14" cy="5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StyleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
      <circle cx="6" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// three linked circles: a residue chain (residue-wise picking)
export function ResidueModeIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path d="M3.2 5h2.6M8.2 5h2.6" />
      <circle cx="2" cy="5" r="1.5" />
      <circle cx="7" cy="5" r="1.5" />
      <circle cx="12" cy="5" r="1.5" />
    </svg>
  );
}

// two circles joined by one bond: atom/bond-wise picking
export function AtomModeIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <path d="M4.6 6.2l4.8-2.4" />
      <circle cx="3" cy="7" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="11" cy="3" r="1.8" />
    </svg>
  );
}

export function BookmarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 2.5h8v11l-4-3-4 3z" />
    </svg>
  );
}

// two atoms with a dashed span: a distance measurement
export function RulerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="3" cy="13" r="1.6" />
      <circle cx="13" cy="3" r="1.6" />
      <path d="M4.6 11.4 L11.4 4.6" strokeDasharray="2 1.6" />
    </svg>
  );
}

// two conformer traces with a dashed gap between them: conformer-spread distances
export function SpreadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 4h11" />
      <path d="M2.5 12h11" opacity="0.6" />
      <path d="M8 5.2v5.6" strokeDasharray="1.6 1.4" />
    </svg>
  );
}

// two atoms joined by a dashed contact: the non-covalent bond overlay
export function BondsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="3.5" cy="12.5" r="1.8" />
      <circle cx="12.5" cy="3.5" r="1.8" />
      <path d="M5.2 10.8 L10.8 5.2" strokeDasharray="1.8 1.5" />
    </svg>
  );
}
