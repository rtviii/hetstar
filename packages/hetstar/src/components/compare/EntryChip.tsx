"use client";
import { ENTRY_GROUP_LABELS, STAGE_LABELS, STAGES, type EntryDef, type EntryGroup, type StageId, type StageState } from "../../lib/lab/entries";
import { knownEntryIds, PDB_ALIASES } from "../../lib/dpdb/resolve";
import type { EntryManifest } from "../../lib/dpdb/types";
import { PinPopover, SectionLabel, Spinner, TinyText, Tooltip } from "./ui";

// The entry's identity on the rail's title line (and on the canvas while the rail is
// hidden). Prints the loaded entry the way dynamicpdb.com does ("PDB 7APT  dpdb_kytgultv":
// the code a reader scans for in the sans, the id muted in the mono), shows one spinner
// while the pipeline runs (its hover card lists the stages) and opens, on click, the
// loader popover: examples, id input, errors, retry, and the pipeline's stages. Where the
// files came from is the rail's Files section.

const DOT_CLASS: Record<StageState, string> = {
  pending: "bg-line-strong",
  active: "bg-accent hs-blink",
  done: "bg-ink-muted",
  error: "bg-danger",
};

function StageList({ stages, error }: { stages: Record<StageId, StageState>; error: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      {STAGES.map((s) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={`hs-pip ${DOT_CLASS[stages[s]]}`} />
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
  onPick,
  examples,
  loading,
  stages,
  error,
  showRetryDensity,
  onRetryDensity,
}: {
  entry: EntryManifest | null;
  entryInput: string;
  onEntryInput: (v: string) => void;
  onLoad: () => void;
  /** load one of the listed examples straight from the dropdown */
  onPick: (id: string) => void;
  /** the preset's example entries: the dropdown's options and the accepted typed ids */
  examples: readonly EntryDef[];
  /** the model half of the pipeline is in flight (density chains in its own effect) */
  loading: boolean;
  stages: Record<StageId, StageState>;
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
      <span className="text-[12.5px] font-semibold text-ink">PDB {entry.pdbId}</span>
      <span className="truncate font-mono text-[10px] text-ink-muted">{entry.source === "dpdb" ? entry.id : "RCSB example"}</span>
    </>
  ) : (
    <span className="hs-label">{loading && entryInput ? entryInput : "load entry"}</span>
  );

  const loadedDef = entry ? examples.find((e) => e.id === entry.pdbId || e.id === entry.id) ?? null : null;
  const groups = (["hetcif", "ensemble"] as EntryGroup[]).map((g) => ({ g, items: examples.filter((e) => e.group === g) })).filter((x) => x.items.length);
  const popover = (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <SectionLabel>Example</SectionLabel>
        <select
          value={loadedDef?.id ?? ""}
          disabled={loading}
          onChange={(e) => {
            if (e.target.value) onPick(e.target.value);
          }}
          className="hs-field w-full"
          aria-label="load an example entry"
        >
          <option value="">pick an example...</option>
          {groups.map(({ g, items }) => (
            <optgroup key={g} label={ENTRY_GROUP_LABELS[g]}>
              {items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {loadedDef?.blurb && <TinyText>{loadedDef.blurb}</TinyText>}
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onLoad();
        }}
      >
        <SectionLabel>Entry id</SectionLabel>
        <div className="flex items-center gap-1.5">
          <input
            list="hetstar-entries"
            value={entryInput}
            onChange={(e) => onEntryInput(e.target.value)}
            placeholder="PDB or dpdb id"
            spellCheck={false}
            className="hs-field min-w-0 flex-1"
          />
          <datalist id="hetstar-entries">
            {knownEntryIds(examples).map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <button type="submit" disabled={loading} className="hs-btn hs-btn-primary">
            {loading ? "loading" : "load"}
          </button>
        </div>
      </form>
      {error && <div className="text-danger">{error}</div>}
      {showRetryDensity && (
        <button type="button" onClick={onRetryDensity} className="hs-btn self-start">
          retry density
        </button>
      )}
      {started && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <SectionLabel>Pipeline</SectionLabel>
          <StageList stages={stages} error={null} />
        </div>
      )}
      <TinyText className="border-t border-line pt-2">
        Any example above by id, any dpdb_... id from the Dynamic PDB catalogue, or {Object.keys(PDB_ALIASES).join(", ")} by PDB id.
        Deposited models and structure factors come from RCSB; qFit models from files.dynamicpdb.com (through the local /api proxy
        in dev); hetcif examples are local files from the hetcif repo.
      </TinyText>
    </div>
  );

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <PinPopover content={popover} align="start" width={300} closeKey={entry?.id}>
        <span
          className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap hover:text-accent"
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
          <span className="hs-pip bg-danger" aria-label="load failed" />
        </Tooltip>
      )}
    </div>
  );
}
