"use client";
import { altColorCss } from "@/lib/molstar/altloc-theme";
import { SectionLabel, TinyText } from "./ui";

// Naive global "states" for model A: one button per altloc letter the structure carries.
// Activating a letter collapses EVERY split residue to that letter (falling back to its
// top-occupancy conformer where the letter is absent); "collapsed" is the default
// top-occupancy choice everywhere. This treats the letters as if they were coupled
// across residues — they are not (qFit assigns letters per residue independently) — so
// this is a stand-in until real state coupling is solved. Per-residue expansion via the
// Selection Actions Panel overrides the global choice on that residue.

export interface StateLetter {
  letter: string;
  /** residues of model A carrying this letter */
  residueCount: number;
}

export default function ConformerStatesPanel({
  letters,
  active,
  disabled,
  onChange,
}: {
  letters: StateLetter[];
  /** the forced letter; null = default collapse (top occupancy per residue) */
  active: string | null;
  disabled?: boolean;
  onChange: (letter: string | null) => void;
}) {
  if (!letters.length) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-2">
      <SectionLabel>Conformer state (model A)</SectionLabel>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={active === null}
          onClick={() => onChange(null)}
          className={`rounded border px-1.5 py-0.5 text-[11px] leading-tight transition-colors disabled:cursor-default disabled:opacity-40 ${
            active === null
              ? "border-sky-700 bg-sky-50 text-sky-900"
              : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
          }`}
        >
          top occ
        </button>
        {letters.map(({ letter, residueCount }) => (
          <button
            key={letter}
            type="button"
            disabled={disabled}
            aria-pressed={active === letter}
            title={`${residueCount} residues carry conformer ${letter}`}
            onClick={() => onChange(active === letter ? null : letter)}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-tight transition-colors disabled:cursor-default disabled:opacity-40 ${
              active === letter
                ? "border-sky-700 bg-sky-50 text-sky-900"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: altColorCss(letter) }} />
            {letter}
            <span className="tabular-nums text-neutral-400">{residueCount}</span>
          </button>
        ))}
      </div>
      <TinyText>
        force one letter on every split residue; the residues it actually switches are painted in the letter color
        (residues without the letter keep their top-occupancy conformer and the base color). Naive: letters are NOT
        coupled across residues.
      </TinyText>
    </div>
  );
}
