"use client";
import { altColorCss } from "@/lib/molstar/altloc-theme";
import { SectionLabel, SwitchButton, Tooltip } from "./ui";

// Naive global "states" for model A: one button per altloc letter the structure carries.
// Activating a letter collapses EVERY split residue to that letter (falling back to its
// top-occupancy conformer where the letter is absent); "collapsed" is the default
// top-occupancy choice everywhere. This treats the letters as if they were coupled
// across residues — they are not (qFit assigns letters per residue independently) — so
// this is a stand-in until real state coupling is solved. Per-residue expansion via the
// Selection Actions Panel overrides the global choice on that residue.
//
// Lives in the bottom tools panel as one row: label + buttons; the explanation is on the
// label's hover card so the row stays compact.

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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Tooltip
        content={
          <div className="flex flex-col gap-1">
            <div className="font-medium">Conformer state, model A</div>
            <div>
              Force one letter on every split residue; the residues it actually switches are painted in the letter
              color (residues without the letter keep their top-occupancy conformer and the base color). Naive: letters
              are NOT coupled across residues.
            </div>
          </div>
        }
      >
        <span className="cursor-help">
          <SectionLabel>Conformer state</SectionLabel>
        </span>
      </Tooltip>
      <div className="flex flex-wrap items-center gap-1">
        <SwitchButton pressed={active === null} disabled={disabled} onClick={() => onChange(null)}>
          top occ
        </SwitchButton>
        {letters.map(({ letter, residueCount }) => (
          <SwitchButton
            key={letter}
            pressed={active === letter}
            disabled={disabled}
            title={`${residueCount} residues carry conformer ${letter}`}
            onClick={() => onChange(active === letter ? null : letter)}
          >
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: altColorCss(letter) }} />
              {letter}
              <span className="tabular-nums text-ink-muted">{residueCount}</span>
            </span>
          </SwitchButton>
        ))}
      </div>
    </div>
  );
}
