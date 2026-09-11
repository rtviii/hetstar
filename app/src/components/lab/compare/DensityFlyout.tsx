"use client";
import type { DensityQuality } from "@/lib/molstar/density";
import {
  METRIC_ORDER,
  METRIC_UI,
  metricLabel,
  metricTooltip,
  metricUnit,
  type MetricId,
  type MetricProvenance,
} from "./metrics";
import { SliderRow, SwitchButton, TinyText, Tooltip } from "./ui";

// Everything density: the metric painted on the 2Fo-Fc surface, the map toggles and
// their knobs, the density quality and the 2D slice map switch. Rendered inside the
// tray's hover flyout on the density icon (whose CLICK toggles the maps themselves);
// all state lives in CompareLabPanel.

const DENSITY_QUALITIES: DensityQuality[] = ["low", "auto", "high"];

// Grouped by what a metric needs, derived from the flags so new metrics slot in.
const METRIC_GROUPS: { title: string; ids: MetricId[] }[] = (() => {
  const modelA: MetricId[] = [];
  const pair: MetricId[] = [];
  const map: MetricId[] = [];
  for (const id of METRIC_ORDER) {
    const ui = METRIC_UI[id];
    (ui.map ? map : ui.pair ? pair : modelA).push(id);
  }
  return [
    { title: "Model A", ids: modelA },
    { title: "A vs B", ids: pair },
    { title: "Map", ids: map },
  ];
})();

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10.5px] uppercase tracking-wide text-ink-muted/75">{children}</span>;
}

export default function DensityFlyout({
  metricId,
  onMetricId,
  densityReady,
  densityBusy,
  hasB,
  hasEnsemble,
  provenance,
  projectedDomain,
  status,
  show2fofc,
  onShow2fofc,
  sigma,
  onSigma,
  showFofc,
  onShowFofc,
  opacity,
  onOpacity,
  densityQuality,
  onDensityQuality,
  showSlice2d,
  onShowSlice2d,
}: {
  metricId: MetricId | "none";
  onMetricId: (id: MetricId | "none") => void;
  densityReady: boolean;
  densityBusy: boolean;
  hasB: boolean;
  /** model A carries several MODEL frames (enables the ensemble metrics) */
  hasEnsemble: boolean;
  provenance: MetricProvenance;
  projectedDomain: [number, number] | null;
  status: string | null;
  show2fofc: boolean;
  onShow2fofc: (v: boolean) => void;
  sigma: number;
  onSigma: (v: number) => void;
  showFofc: boolean;
  onShowFofc: (v: boolean) => void;
  /** factor on the maps' base alphas (both maps), 0.15 to 1 */
  opacity: number;
  onOpacity: (v: number) => void;
  densityQuality: DensityQuality;
  onDensityQuality: (q: DensityQuality) => void;
  showSlice2d: boolean;
  onShowSlice2d: (v: boolean) => void;
}) {
  const metricSwitch = (id: MetricId) => {
    const ui = METRIC_UI[id];
    const tip = metricTooltip(id, provenance);
    const disabled = (ui.map && !densityReady) || (ui.pair && !hasB) || (!!ui.ensemble && !hasEnsemble);
    return (
      <Tooltip
        key={id}
        content={
          <div className="flex flex-col gap-1">
            <div className="font-medium">
              {tip.title}
              {metricUnit(id) ? <span className="text-ink-muted/75"> ({metricUnit(id)})</span> : null}
            </div>
            {tip.lines.map((l, i) => (
              <div key={i} className="break-words">
                {l}
              </div>
            ))}
          </div>
        }
      >
        <SwitchButton pressed={metricId === id} disabled={disabled} onClick={() => onMetricId(id)}>
          {metricLabel(id)}
        </SwitchButton>
      </Tooltip>
    );
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <GroupLabel>Paint metric on the density</GroupLabel>
        {provenance.aDesc && provenance.bDesc && (
          <TinyText>
            A = {provenance.aDesc} (primary) / B = {provenance.bDesc} (ghost)
          </TinyText>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <SwitchButton pressed={metricId === "none"} onClick={() => onMetricId("none")}>
            None
          </SwitchButton>
        </div>
        {METRIC_GROUPS.map((g) =>
          g.ids.length ? (
            <div key={g.title} className="flex flex-col gap-1">
              <span className="text-[9.5px] uppercase tracking-wide text-ink-muted/60">{g.title}</span>
              <div className="flex flex-wrap items-center gap-1">{g.ids.map(metricSwitch)}</div>
            </div>
          ) : null,
        )}
        {!densityReady && (
          <TinyText>map metrics enable with the density; every metric paints the 2Fo-Fc surface once it is there</TinyText>
        )}
        {metricId !== "none" && projectedDomain && (
          <TinyText>
            domain: {projectedDomain[0].toFixed(2)} to {projectedDomain[1].toFixed(2)} {metricUnit(metricId)}; gray = no
            data
          </TinyText>
        )}
        {status && <TinyText>{status}</TinyText>}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-1.5">
        <GroupLabel>Maps</GroupLabel>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={show2fofc} disabled={!densityReady} onChange={(e) => onShow2fofc(e.target.checked)} />
          <span>2Fo-Fc</span>
        </label>
        <SliderRow
          label={`2Fo-Fc contour: ${sigma.toFixed(1)} sigma`}
          min={0.5}
          max={4}
          step={0.1}
          value={sigma}
          disabled={!densityReady || !show2fofc}
          onChange={onSigma}
        />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showFofc} disabled={!densityReady} onChange={(e) => onShowFofc(e.target.checked)} />
          <Tooltip
            content={
              <div className="flex flex-col gap-1">
                <div className="font-medium">Fo-Fc difference map</div>
                <div>
                  Isosurfaces at +3 sigma (green: density the model does not explain) and -3 sigma (red: modeled matter
                  the data lack). Levels fixed; from the same client-side FFT as 2Fo-Fc.
                </div>
              </div>
            }
          >
            <span>Fo-Fc (+3 green / -3 red)</span>
          </Tooltip>
        </label>
        <SliderRow
          label={`map opacity: ${Math.round(opacity * 100)}%`}
          min={0.15}
          max={1}
          step={0.05}
          value={opacity}
          disabled={!densityReady}
          onChange={onOpacity}
        />
        {!densityReady && <TinyText>density loads with the entry; toggles enable when the maps are in</TinyText>}
      </div>

      <div className={`flex flex-col gap-1 border-t border-line pt-1.5 ${densityReady ? "" : "opacity-40"}`}>
        <GroupLabel>Density quality{densityBusy ? " — rebuilding..." : ""}</GroupLabel>
        <div className="flex items-center gap-1">
          {DENSITY_QUALITIES.map((q) => (
            <SwitchButton
              key={q}
              pressed={densityQuality === q}
              disabled={!densityReady || densityBusy}
              onClick={() => onDensityQuality(q)}
            >
              {q}
            </SwitchButton>
          ))}
        </div>
        <TinyText>high re-carves the maps at a finer grid and renders float-textured surfaces (a few seconds)</TinyText>
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-1.5">
        <GroupLabel>2D slice map</GroupLabel>
        <div className="flex items-center gap-1">
          <SwitchButton pressed={!showSlice2d} onClick={() => onShowSlice2d(false)}>
            off
          </SwitchButton>
          <SwitchButton pressed={showSlice2d} onClick={() => onShowSlice2d(true)}>
            on
          </SwitchButton>
        </div>
        <TinyText>
          images the slice plane in the bottom panel; the plane itself (normal, position, what it cuts) is set there
        </TinyText>
      </div>
    </div>
  );
}
