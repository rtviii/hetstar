"use client";
import { useMemo, useState } from "react";
import type { PickInfo } from "../../lib/molstar/viewer";
import type { ResidueRange } from "../../lib/molstar/conformers";
import { altColorCss } from "../../lib/molstar/altloc-theme";
import { conformerSupport, type ConformerSupportRow, type MapSampler } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import type { BondPair } from "../../lib/molstar/interactions";
import BondList, { type BondRow } from "./BondList";
import ConformerStatesPanel, { type StateLetter } from "./ConformerStatesPanel";
import { GroupLabel, SliderRow, TinyText } from "./ui";

// The conformers/selection flyout on the icon tray: reports WHATEVER is selected — a
// single residue gets the per-conformer density-support table with its display knobs, a
// range gets occupancy/heterogeneity aggregates — plus the global conformer-state
// buttons. All selection state lives in HetstarViewer; only the two table-display
// knobs are local.

/** aggregates of the current selection, computed by the host from the atom table */
export interface SelectionSummary {
  /** formatted range label ("A 15-22, 41") */
  label: string;
  residueCount: number;
  splitCount: number;
  /** [conformer count, residues with it], ascending */
  histogram: [number, number][];
  /** mean occupancy of alternate-conformer heavy atoms, null when the selection has none */
  meanAltOcc: number | null;
  /** mean B over heavy atoms, null when B is absent */
  meanB: number | null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 tabular-nums">
      <span className="text-ink-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function SelectionFlyout({
  aTable,
  picked,
  conformerCount,
  conformersShown,
  densitySampler,
  fofcSampler,
  selection,
  summary,
  stateLetters,
  globalAlt,
  onGlobalAlt,
  primaryLoaded,
  memberNums,
  memberIndex,
  onMember,
  bondRows,
  bondsReady,
  bondSummary,
  onBondHover,
  onBondFocus,
  onResetAll,
}: {
  aTable: AtomTable | null;
  /** the sole selected residue, host-derived; null when the selection is not a single residue */
  picked: PickInfo | null;
  /** conformers of the picked residue (1 when unsplit); null when nothing is picked */
  conformerCount: number | null;
  conformersShown: boolean;
  /** 2Fo-Fc sampler in sigma units; null until density is ready */
  densitySampler: MapSampler | null;
  fofcSampler: MapSampler | null;
  selection: ResidueRange[];
  summary: SelectionSummary | null;
  stateLetters: StateLetter[];
  globalAlt: string | null;
  onGlobalAlt: (letter: string | null) => void;
  primaryLoaded: boolean;
  /** pdbx_PDB_model_num of each ensemble member of model A; length < 2 hides the section */
  memberNums: number[];
  memberIndex: number;
  onMember: (i: number) => void;
  /** non-covalent bonds touching the selection (host-filtered, annotated) */
  bondRows: BondRow[];
  /** false while the interaction computation is still running */
  bondsReady: boolean;
  /** conformer/ensemble differences one-liner, null when there is nothing to say */
  bondSummary: string | null;
  onBondHover: (pair: BondPair | null) => void;
  onBondFocus: (pair: BondPair) => void;
  /** reset every structure change (conformers, style, overlays, clip, measurements) */
  onResetAll: () => void;
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <GroupLabel>Selection</GroupLabel>
          <button
            type="button"
            title="back to the freshly-loaded look: collapse conformers, default style, remove bond/representation overlays, clip and measurements. Bookmarks persist."
            className="rounded border border-line-strong bg-white/70 px-1.5 py-px text-[10px] text-ink-secondary transition-colors hover:border-danger/50 hover:text-danger"
            onClick={onResetAll}
          >
            reset all
          </button>
        </div>
        {selection.length === 0 && (
          <TinyText>left click (3D or lanes) selects a residue, shift-click adds to the selection; drag over the lanes for a range; right click opens the actions panel</TinyText>
        )}

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
              label="occupancy floor"
              min={0}
              max={0.5}
              step={0.05}
              value={occFloor}
              display={occFloor.toFixed(2)}
              onChange={setOccFloor}
            />
            <TinyText>rows grayed below the floor: too little occupancy to test</TinyText>
          </>
        )}
        {picked && !supportRows && <TinyText>conformer support appears once density is loaded</TinyText>}

        {!picked && summary && (
          <div className="flex flex-col gap-1">
            <div className="text-[12px] text-ink-secondary">
              {summary.label}
              <span className="text-ink-muted/75"> — {summary.residueCount} residues</span>
            </div>
            <Fact
              label="residues with alternates"
              value={`${summary.splitCount} (${
                summary.residueCount ? Math.round((100 * summary.splitCount) / summary.residueCount) : 0
              }%)`}
            />
            {summary.histogram.map(([n, count]) => (
              <Fact key={n} label={`${n} conformer${n === 1 ? "" : "s"}`} value={`${count} residues`} />
            ))}
            {summary.meanAltOcc != null && (
              <Fact label="mean occupancy (alt atoms)" value={summary.meanAltOcc.toFixed(2)} />
            )}
            {summary.meanB != null && <Fact label="mean B (heavy atoms)" value={summary.meanB.toFixed(1)} />}
          </div>
        )}
      </div>

      {selection.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
          <GroupLabel>Bonds</GroupLabel>
          {!bondsReady ? (
            <TinyText>computing interactions…</TinyText>
          ) : (
            <>
              <BondList rows={bondRows} onHover={onBondHover} onFocus={onBondFocus} />
              {bondSummary && <TinyText>{bondSummary}</TinyText>}
            </>
          )}
        </div>
      )}

      {memberNums.length > 1 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
          <GroupLabel>Ensemble members</GroupLabel>
          <div className="flex items-center gap-1.5 tabular-nums">
            <span className="inline-flex overflow-hidden rounded border border-line-strong bg-white" role="group" aria-label="ensemble member">
              <button
                type="button"
                className="px-1.5 py-0.5 text-ink-secondary hover:bg-accent-soft disabled:opacity-40"
                onClick={() => onMember(memberIndex - 1)}
                disabled={memberIndex <= 0}
                aria-label="previous member"
              >
                &minus;
              </button>
              <button
                type="button"
                className="border-l border-line-strong px-1.5 py-0.5 text-ink-secondary hover:bg-accent-soft disabled:opacity-40"
                onClick={() => onMember(memberIndex + 1)}
                disabled={memberIndex >= memberNums.length - 1}
                aria-label="next member"
              >
                +
              </button>
            </span>
            <span>
              model {memberNums[memberIndex] ?? memberIndex + 1}
              <span className="text-ink-muted"> · {memberIndex + 1}/{memberNums.length}</span>
            </span>
          </div>
          <SliderRow
            label="member"
            min={0}
            max={memberNums.length - 1}
            step={1}
            value={memberIndex}
            onChange={(v) => onMember(Math.round(v))}
          />
          <TinyText>the 3D view, lanes, metrics and the support table all follow the selected member</TinyText>
        </div>
      )}

      <div className="border-t border-line pt-1.5">
        <ConformerStatesPanel letters={stateLetters} active={globalAlt} disabled={!primaryLoaded} onChange={onGlobalAlt} />
        {!stateLetters.length && <TinyText>conformer states appear when model A carries altloc letters</TinyText>}
      </div>
    </div>
  );
}
