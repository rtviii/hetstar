"use client";
import { hexCss } from "../../lib/lab/color";
import { locusLabel, type Locus, type LocusScore } from "../../lib/lab/loci";
import { EyeIcon, LocusIcon, MaskIcon, TargetIcon } from "./icons";
import { TrayButton } from "./StyleTray";
import { CARD_SHELL, OnRequestControls, SwitchButton, TinyText, Tooltip, type TipContent } from "./ui";

// The loci stack: one tray icon carrying the number of loci, which opens (and, pressed
// again, closes) a stack of rows, one per locus. A row names the locus and holds its
// switches (shown, mask shell, select again, remove) and its RSCC: computed on request,
// one number per loaded model over the shared mask, and paintable onto the 2Fo-Fc
// surface inside that mask. Renders nothing while the entry has no loci.

const MASK_TEXT =
  "Every point within 1.5 A of the locus's heavy atoms, in every conformer and every ensemble member: the points over which RSCC compares the map with a model's simulated density.";

const MASK_TIP: TipContent = {
  title: "Draw the mask",
  is: "A faint shell around this model's atoms of the locus.",
  rows: [
    { label: "mask", text: MASK_TEXT },
    { label: "shared", text: "The numbers below are taken over this shell plus the same shell around the other models' atoms." },
  ],
};

const RSCC_TIP: TipContent = {
  title: "RSCC of the locus",
  is: "One correlation per loaded model between the 2Fo-Fc map and the model's simulated density, over the whole locus at once.",
  rows: [
    { label: "mask", text: MASK_TEXT },
    { label: "shared", text: "Every model is scored over the same points, the union of the loaded models' masks, so the numbers compare." },
    { label: "changes", text: "When another model is loaded and the locus is computed again." },
    { label: "ensembles", text: "A large ensemble widens the union, which then describes the surroundings more than the locus." },
    { label: "map", text: "Phased by the deposited model, so it favours that model." },
  ],
};

function formatScore(value: number): string {
  return Number.isNaN(value) ? "n/a" : value.toFixed(3);
}

export default function LociTray({
  loci,
  open,
  onOpen,
  onVisible,
  onMask,
  onSelect,
  onDelete,
  scores,
  computing,
  blocked,
  onCompute,
  onErase,
  paintedId,
  onPaint,
  paintDomain,
}: {
  loci: readonly Locus[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onVisible: (id: string) => void;
  onMask: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  scores: ReadonlyMap<string, LocusScore>;
  /** loci whose RSCC is being computed */
  computing: ReadonlySet<string>;
  /** why no locus can be scored now; null when one can */
  blocked: string | null;
  onCompute: (id: string) => void;
  onErase: (id: string) => void;
  /** the locus whose RSCC is painted on the density */
  paintedId: string | null;
  onPaint: (id: string | null) => void;
  paintDomain: [number, number];
}) {
  if (loci.length === 0) return null;

  const row = (locus: Locus) => {
    const label = locusLabel(locus);
    const score = scores.get(locus.id) ?? null;
    const status = computing.has(locus.id) ? "computing" : score ? "ready" : "absent";
    return (
      <div key={locus.id} className="flex flex-col gap-1 border-t border-line px-2 py-1.5 first:border-t-0">
        <div className="flex items-center gap-1.5">
          <span className="hs-pip" style={{ background: hexCss(locus.color) }} />
          <span className="hs-value min-w-0 flex-1 truncate font-medium" title={label}>
            {label}
          </span>
          <div className="flex shrink-0 items-center gap-px">
            <Tooltip content={locus.visible ? "hide this locus in the 3D view" : "show this locus in the 3D view"}>
              <SwitchButton pressed={locus.visible} onClick={() => onVisible(locus.id)}>
                <EyeIcon />
              </SwitchButton>
            </Tooltip>
            <Tooltip content={MASK_TIP}>
              <SwitchButton pressed={locus.maskShown} disabled={!locus.visible} onClick={() => onMask(locus.id)}>
                <MaskIcon />
              </SwitchButton>
            </Tooltip>
            <Tooltip content="select these atoms again">
              <button type="button" className="hs-btn hs-btn-icon" aria-label="select the locus" onClick={() => onSelect(locus.id)}>
                <TargetIcon />
              </button>
            </Tooltip>
            <Tooltip content="remove this locus (the structure is not touched)">
              <button
                type="button"
                className="hs-btn hs-btn-icon hs-btn-danger"
                aria-label="remove the locus"
                onClick={() => onDelete(locus.id)}
              >
                {"\u00d7"}
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5">
          <Tooltip content={RSCC_TIP}>
            <span className="hs-label">RSCC, shared mask</span>
          </Tooltip>
          {blocked && status !== "ready" ? (
            <TinyText>{blocked}</TinyText>
          ) : (
            <OnRequestControls
              small
              status={status}
              what={`the RSCC of ${label}`}
              onCompute={() => onCompute(locus.id)}
              onErase={() => onErase(locus.id)}
            />
          )}
        </div>

        {score && status !== "computing" && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-2 gap-y-px">
              {score.models.map((model, i) => (
                <div key={model.modelId} className="contents">
                  <span className="truncate text-[10.5px] text-ink-secondary" title={model.name}>
                    {model.name}
                    {i === 0 && <span className="text-ink-faint"> (main view)</span>}
                  </span>
                  <span className="hs-value text-right">{formatScore(model.value)}</span>
                  <span className="hs-unit text-right text-[9.5px]">{model.points} pts</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <TinyText>
                {paintedId === locus.id
                  ? `painted: ${paintDomain[0].toFixed(2)} (red) to ${paintDomain[1].toFixed(2)} (grey)`
                  : `${score.residues.keys.length} residue${score.residues.keys.length === 1 ? "" : "s"} scored`}
              </TinyText>
              <Tooltip
                content={{
                  title: "Paint on the map",
                  is: "The 2Fo-Fc surface inside this locus's shared mask, residue by residue.",
                  rows: [
                    { label: "value", text: "RSCC of the main view's model." },
                    { label: "rest", text: "The map outside the mask keeps its colour." },
                    { label: "also", text: "The same switch as the map column of the style board." },
                  ],
                }}
              >
                <SwitchButton pressed={paintedId === locus.id} onClick={() => onPaint(paintedId === locus.id ? null : locus.id)}>
                  paint
                </SwitchButton>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      <Tooltip content={open ? "close the loci stack" : `${loci.length} loc${loci.length === 1 ? "us" : "i"}: open the stack`}>
        <span className="relative inline-flex">
          <TrayButton active={open} label={`loci (${loci.length})`} onClick={() => onOpen(!open)}>
            <LocusIcon />
          </TrayButton>
          <span className="pointer-events-none absolute -right-1 -top-1 z-[2] flex h-3 min-w-3 items-center justify-center rounded-sm border border-accent-line bg-white px-px font-mono text-[8px] leading-none tabular-nums text-accent">
            {loci.length}
          </span>
        </span>
      </Tooltip>
      {open && (
        <div
          data-hetstar-part="loci"
          className={`absolute right-0 top-7 z-20 flex max-h-[60vh] w-[272px] flex-col overflow-y-auto text-[10.5px] text-ink-secondary ${CARD_SHELL}`}
        >
          <div className="hs-head">
            <span className="hs-head-title">Loci</span>
            <span className="hs-value text-[9.5px] text-ink-muted">{loci.length}</span>
          </div>
          {loci.map(row)}
        </div>
      )}
    </div>
  );
}
