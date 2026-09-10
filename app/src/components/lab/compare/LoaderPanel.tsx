"use client";
import {
  ENTRIES,
  STAGE_LABELS,
  STAGES,
  type EntryDef,
  type ProvenanceRecord,
  type StageId,
  type StageState,
} from "@/lib/lab/entries";
import { PinPopover, SectionLabel, TinyText } from "./ui";

// Entry loader. The staged pipeline dots show only while a load is in flight (or
// failed); the per-file provenance lives in the click-to-pin "sources" popover instead
// of permanent panel real estate — prose first (what each file is, how it was obtained),
// the concrete URL/path underneath, links clickable.

const DOT_CLASS: Record<StageState, string> = {
  pending: "bg-neutral-200",
  active: "bg-sky-500 animate-pulse",
  done: "bg-neutral-500",
  error: "bg-red-600",
};

function ProvRow({ p }: { p: ProvenanceRecord }) {
  const isHttp = !!p.url && /^https?:\/\//.test(p.url);
  return (
    <div className="flex flex-col gap-0.5">
      <div>
        <span className="text-neutral-400">{p.role}:</span> {p.desc}
      </div>
      {p.url &&
        (isHttp ? (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-[10px] leading-tight text-sky-800 hover:underline"
          >
            {p.url}
          </a>
        ) : (
          <div className="break-all font-mono text-[10px] leading-tight text-neutral-500">{p.url}</div>
        ))}
    </div>
  );
}

export default function LoaderPanel({
  entryInput,
  onEntryInput,
  onLoad,
  loading,
  currentEntry,
  stages,
  provenance,
  error,
  showRetryDensity,
  onRetryDensity,
}: {
  entryInput: string;
  onEntryInput: (v: string) => void;
  onLoad: () => void;
  loading: boolean;
  currentEntry: EntryDef | null;
  stages: Record<StageId, StageState>;
  provenance: ProvenanceRecord[];
  error: string | null;
  showRetryDensity: boolean;
  onRetryDensity: () => void;
}) {
  const started = STAGES.some((s) => stages[s] !== "pending");
  const settled = STAGES.every((s) => stages[s] === "done" || stages[s] === "error");
  const anyError = STAGES.some((s) => stages[s] === "error");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Entry</SectionLabel>
        <PinPopover
          content={
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <div className="font-medium text-neutral-700">available entries</div>
                <div>
                  {ENTRIES.map((e) => e.id).join(", ")} — their qFit multiconformer models ship with the app;
                  deposited models and structure factors are fetched from RCSB at load time.
                </div>
              </div>
              {provenance.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-neutral-100 pt-1.5">
                  <div className="font-medium text-neutral-700">{currentEntry?.id} files</div>
                  {provenance.map((p, i) => (
                    <ProvRow key={i} p={p} />
                  ))}
                </div>
              )}
              {settled && (
                <div className="border-t border-neutral-100 pt-1.5 text-neutral-400">
                  pipeline: {STAGES.map((s) => STAGE_LABELS[s]).join(" - ")}
                  {anyError ? " (some stages failed)" : " (all done)"}
                </div>
              )}
            </div>
          }
        >
          <span className="text-[10.5px] text-neutral-400 underline decoration-dotted underline-offset-2 hover:text-neutral-600">
            sources
          </span>
        </PinPopover>
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad();
        }}
      >
        <input
          list="compare-lab-entries"
          value={entryInput}
          onChange={(e) => onEntryInput(e.target.value)}
          placeholder="PDB id"
          spellCheck={false}
          className="w-20 rounded border border-neutral-300 bg-white px-1.5 py-0.5 uppercase tracking-wide"
        />
        <datalist id="compare-lab-entries">
          {ENTRIES.map((e) => (
            <option key={e.id} value={e.id} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-neutral-300 bg-white px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40"
        >
          {loading ? "loading..." : "load"}
        </button>
      </form>
      {error && <div className="text-[11px] text-red-700">{error}</div>}

      {started && !settled && (
        <div className="flex flex-col gap-0.5">
          {STAGES.map((s) => (
            <div key={s} className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[stages[s]]}`} />
              <span className={stages[s] === "error" ? "text-red-700" : undefined}>{STAGE_LABELS[s]}</span>
            </div>
          ))}
        </div>
      )}
      {showRetryDensity && (
        <button
          type="button"
          onClick={onRetryDensity}
          className="self-start rounded border border-neutral-300 bg-white px-2 py-0.5 text-[11px] hover:bg-neutral-100"
        >
          retry density
        </button>
      )}
      {!started && <TinyText>click &quot;sources&quot; for the available entries and file provenance</TinyText>}
    </div>
  );
}
