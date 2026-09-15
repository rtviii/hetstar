"use client";
import { ENTRIES, STAGE_LABELS, STAGES, type ProvenanceRecord, type StageId, type StageState } from "../../lib/lab/entries";
import { knownEntryIds, PDB_ALIASES } from "../../lib/dpdb/resolve";
import type { EntryManifest } from "../../lib/dpdb/types";
import { PinPopover, Spinner, TinyText, Tooltip } from "./ui";

// The entry chip at the top of the sidebar, above the entry card. Prints the loaded
// entry the way dynamicpdb.com does ("PDB 7APT | dpdb_kytgultv": the code a reader scans
// for emphasized, the source/id muted), shows one spinner while the pipeline runs — its
// hover card lists the stages — and opens, on click, the loader popover: id input, known
// ids, errors, retry, and the per-file provenance.

const DOT_CLASS: Record<StageState, string> = {
  pending: "bg-line-strong",
  active: "bg-accent animate-pulse",
  done: "bg-ink-muted",
  error: "bg-danger",
};

function ProvRow({ p }: { p: ProvenanceRecord }) {
  const isHttp = !!p.url && /^https?:\/\//.test(p.url);
  return (
    <div className="flex flex-col gap-0.5">
      <div>
        <span className="text-ink-muted/75">{p.role}:</span> {p.desc}
      </div>
      {p.url &&
        (isHttp ? (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-[10px] leading-tight text-accent hover:underline"
          >
            {p.url}
          </a>
        ) : (
          <div className="break-all font-mono text-[10px] leading-tight text-ink-muted">{p.url}</div>
        ))}
    </div>
  );
}

// one line of what the catalogue said about a live entry, so the cross-talk is visible
function CatalogueLine({ m }: { m: EntryManifest }) {
  const fmt = (v: number | undefined) => (v == null ? "?" : v.toFixed(3));
  const qfit = m.models.find((x) => x.role === "qfit");
  const listed = m.models.map((x) => x.title.replace(/ model$/i, "")).join(", ");
  return (
    <div className="text-ink-muted">
      catalogue: {m.title}
      {m.resolution != null ? `, ${m.resolution.toFixed(2)} Å` : ""}
      {qfit && (qfit.metrics.r_work != null || qfit.metrics.r_free != null)
        ? `; qFit R-work ${fmt(qfit.metrics.r_work)} / R-free ${fmt(qfit.metrics.r_free)}`
        : ""}
      ; models listed: {listed}
    </div>
  );
}

function StageList({ stages, error }: { stages: Record<StageId, StageState>; error: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      {STAGES.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[stages[s]]}`} />
          <span className={stages[s] === "error" ? "text-danger" : undefined}>{STAGE_LABELS[s]}</span>
        </div>
      ))}
      {error && <div className="pt-1 text-danger">{error}</div>}
    </div>
  );
}

export default function EntryChip({
  entry,
  entryInput,
  onEntryInput,
  onLoad,
  loading,
  stages,
  provenance,
  error,
  showRetryDensity,
  onRetryDensity,
}: {
  entry: EntryManifest | null;
  entryInput: string;
  onEntryInput: (v: string) => void;
  onLoad: () => void;
  /** the model half of the pipeline is in flight (density chains in its own effect) */
  loading: boolean;
  stages: Record<StageId, StageState>;
  provenance: ProvenanceRecord[];
  error: string | null;
  showRetryDensity: boolean;
  onRetryDensity: () => void;
}) {
  // `loading` alone misses the density stages; `started && !settled` alone would spin
  // forever after a catalogue failure leaves the density stages pending — so failure wins.
  const started = STAGES.some((s) => stages[s] !== "pending");
  const settled = STAGES.every((s) => stages[s] === "done" || stages[s] === "error");
  const failed = STAGES.some((s) => stages[s] === "error") || !!error;
  const busy = !failed && started && !settled;

  const identity = entry ? (
    <>
      <span className="font-semibold text-ink-secondary">PDB {entry.pdbId}</span>
      <span className="mx-1.5 opacity-50">|</span>
      <span className="text-ink-muted">{entry.source === "dpdb" ? entry.id : "RCSB example"}</span>
    </>
  ) : (
    <span className="text-ink-muted">{loading && entryInput ? entryInput : "load entry"}</span>
  );

  const popover = (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad();
        }}
      >
        <input
          list="hetstar-entries"
          value={entryInput}
          onChange={(e) => onEntryInput(e.target.value)}
          placeholder="PDB or dpdb id"
          spellCheck={false}
          className="w-36 rounded border border-line-strong bg-white px-1.5 py-0.5 tracking-wide focus:border-accent focus:outline-none focus:shadow-ring-accent"
        />
        <datalist id="hetstar-entries">
          {knownEntryIds().map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-line-strong bg-white px-2 py-0.5 hover:bg-line disabled:opacity-40"
        >
          {loading ? "loading..." : "load"}
        </button>
      </form>
      {error && <div className="text-danger">{error}</div>}
      {showRetryDensity && (
        <button
          type="button"
          onClick={onRetryDensity}
          className="self-start rounded border border-line-strong bg-white px-2 py-0.5 hover:bg-line"
        >
          retry density
        </button>
      )}
      {provenance.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-1.5">
          <div className="font-medium text-ink-secondary">
            {entry?.pdbId}
            {entry?.source === "dpdb" ? ` (${entry.id})` : ""} files
          </div>
          {entry?.source === "dpdb" && <CatalogueLine m={entry} />}
          {provenance.map((p, i) => (
            <ProvRow key={i} p={p} />
          ))}
        </div>
      )}
      {settled && (
        <div className="border-t border-line pt-1.5 text-ink-muted/75">
          pipeline: {STAGES.map((s) => STAGE_LABELS[s]).join(" - ")}
          {failed ? " (some stages failed)" : " (all done)"}
        </div>
      )}
      <TinyText className="border-t border-line pt-1.5">
        RCSB examples: {ENTRIES.map((e) => e.id).join(", ")} (deposited NMR ensembles). Dynamic PDB catalogue:
        any dpdb_... id, or {Object.keys(PDB_ALIASES).join(", ")} by PDB id. Deposited models and structure factors
        come from RCSB; qFit models from files.dynamicpdb.com (through the local /api proxy in dev).
      </TinyText>
    </div>
  );

  return (
    <div className="flex h-6 items-center gap-1.5 self-start rounded border border-line bg-white/85 px-2 font-mono text-[11px]">
      <PinPopover content={popover} align="start" closeKey={entry?.id}>
        <span
          className="flex items-center whitespace-nowrap"
          title={entry ? `${entry.title} (click to load another entry)` : "click to load an entry"}
        >
          {identity}
        </span>
      </PinPopover>
      {busy && (
        <Tooltip content={<StageList stages={stages} error={error} />}>
          <Spinner />
        </Tooltip>
      )}
      {failed && (
        <Tooltip content={<StageList stages={stages} error={error} />}>
          <span className="inline-block h-2 w-2 rounded-full bg-danger" aria-label="load failed" />
        </Tooltip>
      )}
    </div>
  );
}
