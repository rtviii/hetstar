"use client";
import { useMemo, useState } from "react";
import type { PickInfo } from "@/lib/molstar/viewer";
import { altColorCss } from "@/lib/molstar/altloc-theme";
import { conformerSupport, type ConformerSupportRow, type MapSampler } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import { SectionLabel, SliderRow, TinyText } from "./ui";

// Selection readout: the picked residue plus the per-conformer density-support table
// (model A) with its two display knobs. Presentation-local state lives here.

export default function SelectionPanel({
  aTable,
  picked,
  conformerCount,
  conformersShown,
  densitySampler,
  fofcSampler,
}: {
  aTable: AtomTable | null;
  picked: PickInfo | null;
  /** conformers of the picked residue (1 when unsplit); null when nothing is picked */
  conformerCount: number | null;
  conformersShown: boolean;
  /** 2Fo-Fc sampler in sigma units; null until density is ready */
  densitySampler: MapSampler | null;
  fofcSampler: MapSampler | null;
}) {
  const [occNormalize, setOccNormalize] = useState(false);
  const [occFloor, setOccFloor] = useState(0.2);

  // Per-conformer support for the picked residue: one row per altloc letter plus the
  // shared atoms, 2Fo-Fc and Fo-Fc means in sigma units.
  const supportRows = useMemo(() => {
    if (!aTable || !picked || !densitySampler) return null;
    const res = aTable.residues.find((r) => r.ref.chain === picked.chainId && r.ref.seq === picked.authSeqId);
    if (!res) return null;
    const twoFo = conformerSupport(aTable, res.rows, densitySampler);
    const fofcByAlt = new Map<string, ConformerSupportRow>();
    if (fofcSampler) for (const row of conformerSupport(aTable, res.rows, fofcSampler)) fofcByAlt.set(row.alt, row);
    return twoFo.map((row) => ({ ...row, fofcMean: fofcByAlt.get(row.alt)?.mean ?? NaN }));
  }, [aTable, picked, densitySampler, fofcSampler]);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <SectionLabel>Selection</SectionLabel>
      {!picked && <TinyText>left click selects a residue; right click opens the actions panel</TinyText>}
      {picked && (
        <div className="text-[12px] text-ink-secondary">
          {picked.compId} {picked.chainId}/{picked.authSeqId}
          {conformerCount != null && (
            <span className="text-ink-muted/75">
              {" "}
              — {conformerCount > 1 ? `${conformerCount} conformers${conformersShown ? " (shown)" : ""}` : "unsplit"}
            </span>
          )}
        </div>
      )}

      {picked && supportRows && (
        <>
          <div className="text-[11px] text-ink-muted">Conformer support (model A)</div>
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="text-[11px] text-ink-muted">
                <th className="font-normal">conf</th>
                <th className="font-normal">occ</th>
                <th className="font-normal">atoms</th>
                <th className="font-normal">2Fo-Fc</th>
                <th className="font-normal">Fo-Fc</th>
              </tr>
            </thead>
            <tbody>
              {supportRows.map((row) => {
                const belowFloor = row.alt !== "" && row.occupancy < occFloor;
                const show = (v: number) => {
                  const x = occNormalize && row.occupancy > 0 ? v / row.occupancy : v;
                  return Number.isNaN(x) ? "-" : x.toFixed(2);
                };
                return (
                  <tr key={row.alt || "shared"} className={belowFloor ? "text-ink-muted/75" : undefined}>
                    <td>
                      {row.alt ? (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="inline-block h-2 w-2 rounded-[2px]"
                            style={{ background: altColorCss(row.alt) }}
                          />
                          {row.alt}
                        </span>
                      ) : (
                        "shared"
                      )}
                    </td>
                    <td>{Number.isNaN(row.occupancy) ? "-" : row.occupancy.toFixed(2)}</td>
                    <td>{row.atomCount}</td>
                    <td>{show(row.mean)}</td>
                    <td>{show(row.fofcMean)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="flex items-center gap-2 text-[11px] text-ink-secondary">
            <input type="checkbox" checked={occNormalize} onChange={(e) => setOccNormalize(e.target.checked)} />
            <span>per unit occupancy (value / occ)</span>
          </label>
          <SliderRow
            label={`occupancy floor: ${occFloor.toFixed(2)} (grayed below: too little occupancy to test)`}
            min={0}
            max={0.5}
            step={0.05}
            value={occFloor}
            onChange={setOccFloor}
          />
        </>
      )}
      {picked && !supportRows && <TinyText>conformer support appears once density is loaded</TinyText>}
    </div>
  );
}
