"use client";
import type { PickInfo } from "@/lib/molstar/viewer";
import {
  METRIC_ORDER,
  METRIC_UI,
  metricLabel,
  metricTooltip,
  metricUnit,
  type MetricId,
  type MetricProvenance,
} from "./metrics";
import { SectionLabel, SwitchButton, TinyText, Tooltip } from "./ui";

// Metric switch toolbar + scope controls. Each switch carries a tooltip stating exactly
// how the metric is computed and from which files (interpolated from the load provenance).

export type ScopeMode = "all" | "residue" | "range";

export default function MetricsToolbar({
  metricId,
  onMetricId,
  densityReady,
  hasB,
  provenance,
  scopeMode,
  onScopeMode,
  picked,
  rangeChain,
  rangeFrom,
  rangeTo,
  onRangeChain,
  onRangeFrom,
  onRangeTo,
  projectedDomain,
  status,
}: {
  metricId: MetricId | "none";
  onMetricId: (id: MetricId | "none") => void;
  densityReady: boolean;
  hasB: boolean;
  provenance: MetricProvenance;
  scopeMode: ScopeMode;
  onScopeMode: (m: ScopeMode) => void;
  picked: PickInfo | null;
  rangeChain: string;
  rangeFrom: string;
  rangeTo: string;
  onRangeChain: (v: string) => void;
  onRangeFrom: (v: string) => void;
  onRangeTo: (v: string) => void;
  projectedDomain: [number, number] | null;
  status: string | null;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-2">
      <SectionLabel>Metric on density</SectionLabel>
      {provenance.aDesc && provenance.bDesc && (
        <TinyText>
          A = {provenance.aDesc} (primary) / B = {provenance.bDesc} (ghost)
        </TinyText>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <SwitchButton pressed={metricId === "none"} onClick={() => onMetricId("none")}>
          none
        </SwitchButton>
        {METRIC_ORDER.map((id) => {
          const ui = METRIC_UI[id];
          const tip = metricTooltip(id, provenance);
          const disabled = !densityReady || (ui.pair && !hasB);
          return (
            <Tooltip
              key={id}
              content={
                <div className="flex flex-col gap-1">
                  <div className="font-medium">
                    {tip.title}
                    {metricUnit(id) ? <span className="text-neutral-400"> ({metricUnit(id)})</span> : null}
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
                {ui.button}
              </SwitchButton>
            </Tooltip>
          );
        })}
      </div>
      {!densityReady && <TinyText>metrics project onto the 2Fo-Fc surface; they enable with the density</TinyText>}
      {metricId !== "none" && projectedDomain && (
        <TinyText>
          domain: {projectedDomain[0].toFixed(2)} to {projectedDomain[1].toFixed(2)} {metricUnit(metricId)}; gray =
          no data
        </TinyText>
      )}

      <div className="flex items-center gap-3">
        <span className="text-[11px] text-neutral-500">scope</span>
        {(["all", "residue", "range"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input type="radio" checked={scopeMode === m} onChange={() => onScopeMode(m)} />
            <span>{m}</span>
          </label>
        ))}
      </div>
      {scopeMode === "residue" && (
        <TinyText>
          {picked ? `scoped to ${picked.compId} ${picked.chainId}/${picked.authSeqId}` : "click a residue in 3D"}
        </TinyText>
      )}
      {scopeMode === "range" && (
        <div className="flex items-center gap-1">
          <input
            className="w-10 rounded border border-neutral-300 px-1 py-0.5"
            value={rangeChain}
            onChange={(e) => onRangeChain(e.target.value.trim())}
            placeholder="A"
          />
          <input
            className="w-14 rounded border border-neutral-300 px-1 py-0.5"
            value={rangeFrom}
            onChange={(e) => onRangeFrom(e.target.value.trim())}
            placeholder="from"
          />
          <span className="text-neutral-400">to</span>
          <input
            className="w-14 rounded border border-neutral-300 px-1 py-0.5"
            value={rangeTo}
            onChange={(e) => onRangeTo(e.target.value.trim())}
            placeholder="to"
          />
        </div>
      )}
      {status && <TinyText>{status}</TinyText>}
    </div>
  );
}
