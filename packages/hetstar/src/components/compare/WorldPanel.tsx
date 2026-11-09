"use client";
import { useMemo, useState } from "react";
import {
  BACKBONE_ATOMS,
  hetcifComponents,
  hetcifRowFor,
  hetcifStateRows,
  hetcifTableFor,
  hetcifWorldCount,
  hetcifWorlds,
  isHeavy,
  type AtomTable,
  type HetcifModel,
  type HetcifRowIndex,
  type HetcifState,
  type HetcifTable,
  type HetcifVariable,
  type HetcifWorld,
} from "@dynamic-pdb/hetkit/model";
import { altColorCss } from "../../lib/molstar/altloc-theme";
import { GroupLabel, SectionLabel, SwitchButton, TinyText } from "./ui";

// The world chooser for a file that carries hetcif categories (~/dev/hetcif, docs/format.md).
// A world is one state per variable; the viewer shows exactly one. This panel explains the
// file's variables in words derived from the atoms they select (which residues, backbone or
// side chain, how many atoms), shows each correlated group with the reason for the coupling
// and its legal worlds against what independence would give, and lets the user move single
// variables (those touching the selection, or found by the search box) or whole groups.

export interface WorldPanelProps {
  model: HetcifModel;
  table: AtomTable;
  index: HetcifRowIndex;
  /** marginal P(variable = state), keyed `${variable}|${state}` */
  marginals: Map<string, number>;
  /** the world in force: top world with the user's overrides applied */
  world: Record<string, string>;
  /** variables the user moved off the top world */
  overridden: ReadonlySet<string>;
  /** variables touching the current selection, in file order */
  selectedVariables: string[];
  disabled?: boolean;
  onChoose: (variable: string, state: string) => void;
  onChooseMany: (states: Record<string, string>) => void;
  onReset: () => void;
}

const MAX_WORLDS = 12;
const MAX_FOUND = 10;
const MAX_FORBIDDEN = 8;

// --- words for the file's vocabulary ------------------------------------------------

const KIND_WORDS: Record<string, string> = {
  conformational: "same atoms in every state, different positions",
  compositional: "atoms present in some states and absent in others",
  mixed: "some atoms exist only in some states (protonation, partial side chains)",
  unknown: "kind not stated",
};

const PROVENANCE_WORDS: Record<string, string> = {
  fit: "fitted: the probabilities are refined occupancies",
  restraint: "a restraint of the refinement",
  assert: "asserted: written by hand or by a script, not fitted to data",
  measured: "measured directly",
  unknown: "provenance not stated",
};

function titleCase(comp: string): string {
  return comp.length <= 1 ? comp : comp[0] + comp.slice(1).toLowerCase();
}

/** every atom row of any state of the variable */
function variableRows(index: HetcifRowIndex, vid: string): number[] {
  const out = new Set<number>();
  for (const rows of hetcifStateRows(index, vid).values()) for (const i of rows) out.add(i);
  return [...out];
}

interface VariableWords {
  /** short: "Arg102 side chain", "Glu3 to Lys5 backbone + side chains (3 residues)" */
  label: string;
  /** one sentence on what the variable is */
  sentence: string;
  residueCount: number;
  heavyAtoms: number;
  isWater: boolean;
}

function describeVariable(table: AtomTable, index: HetcifRowIndex, v: HetcifVariable): VariableWords {
  const rows = variableRows(index, v.id);
  const residues = new Map<string, { chain: string; seq: number; comp: string }>();
  let backbone = false;
  let side = false;
  let heavy = 0;
  for (const i of rows) {
    const key = `${table.chain[i]}|${table.seq[i]}|${table.ins[i]}`;
    if (!residues.has(key)) residues.set(key, { chain: table.chain[i], seq: table.seq[i], comp: table.compId[i] });
    if (!isHeavy(table, i)) continue;
    heavy++;
    if (BACKBONE_ATOMS.has(table.atomName[i])) backbone = true;
    else side = true;
  }
  const list = [...residues.values()].sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : a.seq - b.seq));
  const n = list.length;
  const isWater = n > 0 && list.every((r) => r.comp === "HOH" || r.comp === "WAT" || r.comp === "DOD");
  const absent = v.states.some((s) => s.members.length === 0);
  const nStates = v.states.length;

  if (n === 0) {
    return { label: v.id, sentence: `${v.id}: ${nStates} states; none of its selectors matched an atom of this model.`, residueCount: 0, heavyAtoms: 0, isWater: false };
  }
  const first = list[0];
  const last = list[n - 1];
  const range = n === 1 ? `${titleCase(first.comp)}${first.seq}` : `${titleCase(first.comp)}${first.seq} to ${titleCase(last.comp)}${last.seq}`;
  const chain = first.chain;
  const part = backbone && side ? (n === 1 ? "whole residue" : "backbone + side chains") : backbone ? "backbone" : "side chain" + (n === 1 ? "" : "s");

  if (isWater) {
    const label = n === 1 ? `water ${first.seq}` : `${n} waters ${first.seq}..${last.seq}`;
    const sentence = absent
      ? `Partial water${n === 1 ? "" : "s"} ${range} (chain ${chain}): present in some copies of the crystal, absent in others. One ordered position, one empty state.`
      : `Water${n === 1 ? "" : "s"} ${range} (chain ${chain}) with ${nStates} alternative positions.`;
    return { label, sentence, residueCount: n, heavyAtoms: heavy, isWater: true };
  }

  const label = n === 1 ? `${range} ${part}` : `${range} ${part} (${n} residues)`;
  let sentence: string;
  if (n > 1) {
    sentence = `One choice for ${n} residues at once: qFit sampled the ${part} of ${range} (chain ${chain}) as a unit, so one state picks the conformer for every residue of the segment. ${nStates} conformers.`;
  } else if (part === "side chain") {
    sentence = `The side chain of ${range} (chain ${chain}) chooses among ${nStates} rotamers while its backbone is decided elsewhere.`;
  } else {
    sentence = `${range} (chain ${chain}), ${part}: ${nStates} alternative conformers.`;
  }
  if (absent) sentence += " One state has no atoms (absent).";
  return { label, sentence, residueCount: n, heavyAtoms: heavy, isWater: false };
}

interface StateStats {
  heavy: number;
  meanB: number | null;
  letters: string[];
}

function stateStats(table: AtomTable, rows: number[]): StateStats {
  let heavy = 0;
  let bSum = 0;
  let bN = 0;
  const letters = new Set<string>();
  for (const i of rows) {
    if (table.altId[i]) letters.add(table.altId[i]);
    if (!isHeavy(table, i)) continue;
    heavy++;
    const b = table.bIso[i];
    if (!Number.isNaN(b)) {
      bSum += b;
      bN++;
    }
  }
  return { heavy, meanB: bN ? bSum / bN : null, letters: [...letters].sort() };
}

function Swatch({ letters }: { letters: string[] }) {
  if (!letters.length) return <span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-dashed border-line-strong" title="no atoms" />;
  return (
    <span className="inline-flex gap-px">
      {letters.slice(0, 4).map((l) => (
        <span key={l} className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: altColorCss(l) }} title={`altloc ${l}`} />
      ))}
    </span>
  );
}

function fmtP(p: number): string {
  return p.toFixed(p > 0 && p < 0.01 ? 3 : 2);
}

// --- state table of one variable ----------------------------------------------------

function VariableCard({
  v,
  model,
  table,
  index,
  marginals,
  world,
  moved,
  disabled,
  onChoose,
}: {
  v: HetcifVariable;
  model: HetcifModel;
  table: AtomTable;
  index: HetcifRowIndex;
  marginals: Map<string, number>;
  world: Record<string, string>;
  moved: boolean;
  disabled?: boolean;
  onChoose: (variable: string, state: string) => void;
}) {
  const words = useMemo(() => describeVariable(table, index, v), [table, index, v]);
  const owner = hetcifTableFor(model, v.id);
  const rowInForce = owner ? hetcifRowFor(owner, world) : null;
  const rows = hetcifStateRows(index, v.id);
  const children = [...model.tables.values()].filter((t) => t.parents.includes(v.id)).map((t) => t.child);

  return (
    <div className={`flex flex-col gap-1 rounded border px-1.5 py-1 ${moved ? "border-accent/60 bg-accent-soft/40" : "border-line bg-white/40"}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[11px] text-ink">{v.id}</span>
        <span className="text-[11px] text-ink-secondary">{words.label}</span>
        {moved && <span className="text-[10px] text-accent">moved off the top world</span>}
      </div>
      <TinyText>{words.sentence}</TinyText>
      <TinyText>
        {KIND_WORDS[v.kind ?? "unknown"] ?? v.kind}; {PROVENANCE_WORDS[v.provenance ?? "unknown"] ?? v.provenance}.
        {owner && (
          <>
            {" "}
            Its probabilities are not its own: table {owner.id} gives them given {owner.parents.join(" and ")}
            {rowInForce ? `, and the row in force now is "${rowInForce.id}"` : ""}.
          </>
        )}
        {children.length > 0 && <> It is a parent of {children.join(", ")}.</>}
      </TinyText>
      {v.details && <TinyText className="italic">{v.details}</TinyText>}
      <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] items-center gap-x-2 gap-y-0.5 text-[10.5px] tabular-nums">
        <span className="text-ink-muted/70">state</span>
        <span />
        <span className="text-ink-muted/70">what it is</span>
        <span className="text-right text-ink-muted/70" title="marginal probability over all worlds">p</span>
        <span className="text-right text-ink-muted/70" title={owner ? "probability given the parents' current states" : "the variable's own probability"}>
          {owner ? "p | parents" : ""}
        </span>
        <span className="text-right text-ink-muted/70">atoms · B</span>
        {v.states.map((s) => (
          <StateRow
            key={s.id}
            s={s}
            vid={v.id}
            table={table}
            rows={rows.get(s.id) ?? []}
            marginal={marginals.get(`${v.id}|${s.id}`) ?? 0}
            conditional={owner ? (rowInForce?.p[s.id] ?? 0) : null}
            isWater={words.isWater}
            pressed={world[v.id] === s.id}
            disabled={disabled}
            onChoose={onChoose}
          />
        ))}
      </div>
    </div>
  );
}

function StateRow({
  s,
  vid,
  table,
  rows,
  marginal,
  conditional,
  isWater,
  pressed,
  disabled,
  onChoose,
}: {
  s: HetcifState;
  vid: string;
  table: AtomTable;
  rows: number[];
  marginal: number;
  conditional: number | null;
  isWater: boolean;
  pressed: boolean;
  disabled?: boolean;
  onChoose: (variable: string, state: string) => void;
}) {
  const stats = useMemo(() => stateStats(table, rows), [table, rows]);
  const what =
    s.details ??
    (stats.heavy === 0
      ? isWater
        ? "absent: no ordered water in this copy"
        : "absent: these atoms are not present"
      : stats.letters.length
        ? `altloc ${stats.letters.join("/")}`
        : "the rows with no altloc");
  return (
    <>
      <SwitchButton pressed={pressed} disabled={disabled} title={`show ${vid} = ${s.id}`} onClick={() => onChoose(vid, s.id)}>
        <span className="font-mono">{s.id}</span>
      </SwitchButton>
      <Swatch letters={stats.letters} />
      <span className={`truncate ${pressed ? "text-ink" : "text-ink-secondary"}`}>{what}</span>
      <span className="text-right">{fmtP(marginal)}</span>
      <span className="text-right text-ink-muted">{conditional === null ? "" : fmtP(conditional)}</span>
      <span className="text-right text-ink-muted">
        {stats.heavy}
        {stats.meanB !== null ? ` · ${stats.meanB.toFixed(0)}` : ""}
      </span>
    </>
  );
}

// --- correlated groups ----------------------------------------------------------------

interface GroupInfo {
  variables: string[];
  tables: HetcifTable[];
  worlds: HetcifWorld[];
  /** combinations the tables rule out (zero probability), with the mass independence would give them */
  forbidden: { states: Record<string, string>; indep: number }[];
  total: number;
}

function groupInfo(model: HetcifModel, comp: string[], marginals: Map<string, number>): GroupInfo {
  const worlds = hetcifWorlds(model, comp).sort((a, b) => b.p - a.p);
  const total = hetcifWorldCount(model, comp);
  const tables = [...model.tables.values()].filter((t) => comp.includes(t.child));
  const forbidden: GroupInfo["forbidden"] = [];
  if (total <= 512) {
    const legal = new Set(worlds.map((w) => comp.map((v) => w.states[v]).join("\u0000")));
    const rec = (i: number, acc: Record<string, string>, indep: number) => {
      if (i === comp.length) {
        if (!legal.has(comp.map((v) => acc[v]).join("\u0000"))) forbidden.push({ states: { ...acc }, indep });
        return;
      }
      for (const s of model.variables.get(comp[i])!.states) {
        acc[comp[i]] = s.id;
        rec(i + 1, acc, indep * (marginals.get(`${comp[i]}|${s.id}`) ?? 0));
      }
      delete acc[comp[i]];
    };
    rec(0, {}, 1);
    forbidden.sort((a, b) => b.indep - a.indep);
  }
  return { variables: comp, tables, worlds, forbidden, total };
}

function independentP(w: Record<string, string>, vids: string[], marginals: Map<string, number>): number {
  let p = 1;
  for (const v of vids) p *= marginals.get(`${v}|${w[v]}`) ?? 0;
  return p;
}

function couplingWords(p: number, indep: number): string {
  if (indep <= 0) return "impossible under independence";
  const r = p / indep;
  if (r > 1.15) return `${r.toFixed(1)}x more than if independent`;
  if (r < 0.85) return `${r.toFixed(2)}x of independent`;
  return "about as if independent";
}

function StateChips({ states, vids, labels }: { states: Record<string, string>; vids: string[]; labels: Map<string, string> }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {vids.map((v) => {
        const s = states[v];
        const letter = /^[A-Z]$/.test(s);
        return (
          <span key={v} className="inline-flex items-center gap-0.5 font-mono text-[10.5px]" title={labels.get(v) ?? v}>
            {letter && <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: altColorCss(s) }} />}
            <span className="text-ink-muted">{v}=</span>
            <span>{s}</span>
          </span>
        );
      })}
    </span>
  );
}

function GroupCard({
  g,
  labels,
  marginals,
  world,
  disabled,
  onChooseMany,
}: {
  g: GroupInfo;
  labels: Map<string, string>;
  marginals: Map<string, number>;
  world: Record<string, string>;
  disabled?: boolean;
  onChooseMany: (states: Record<string, string>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? g.worlds : g.worlds.slice(0, MAX_WORLDS);
  const inForce = g.worlds.find((w) => g.variables.every((v) => world[v] === w.states[v]));
  return (
    <div className="flex flex-col gap-1 rounded border border-line bg-white/40 px-1.5 py-1">
      <div className="flex flex-col gap-0.5">
        {g.variables.map((v) => (
          <div key={v} className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
            <span className="font-mono text-ink">{v}</span>
            <span className="text-ink-secondary">{labels.get(v)}</span>
          </div>
        ))}
      </div>
      {g.tables.map((t) => (
        <TinyText key={t.id}>
          <span className="font-mono">{t.id}</span>: {t.child} depends on {t.parents.join(" and ")}
          {t.provenance ? ` (${t.provenance})` : ""}
          {t.details ? `. ${t.details}` : ""}
        </TinyText>
      ))}
      <TinyText>
        {g.worlds.length} of {g.total} combinations can occur; the joint probability of each, and how it compares with the product of the
        marginals. Pick one to show it.
      </TinyText>
      <div className="flex flex-col gap-0.5">
        {shown.map((w) => {
          const active = g.variables.every((v) => world[v] === w.states[v]);
          const indep = independentP(w.states, g.variables, marginals);
          return (
            <button
              key={g.variables.map((v) => w.states[v]).join("/")}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChooseMany(w.states)}
              className={`flex items-center gap-2 rounded border px-1.5 py-0.5 text-left transition-colors disabled:cursor-default disabled:opacity-40 ${
                active ? "border-accent bg-accent-soft text-accent" : "border-line-strong/50 bg-white/60 text-ink-secondary hover:bg-line/70"
              }`}
            >
              <StateChips states={w.states} vids={g.variables} labels={labels} />
              <span className="ml-auto whitespace-nowrap tabular-nums text-[10.5px]">
                {fmtP(w.p)}
                <span className="text-ink-muted"> · {couplingWords(w.p, indep)}</span>
              </span>
            </button>
          );
        })}
        {g.worlds.length > MAX_WORLDS && (
          <button type="button" className="self-start text-[10.5px] text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "fewer" : `+${g.worlds.length - MAX_WORLDS} more worlds`}
          </button>
        )}
      </div>
      {g.forbidden.length > 0 && (
        <TinyText>
          Ruled out ({g.forbidden.length}):{" "}
          {g.forbidden.slice(0, MAX_FORBIDDEN).map((f, i) => (
            <span key={i}>
              {i > 0 && "; "}
              <span className="font-mono">{g.variables.map((v) => f.states[v]).join("/")}</span>
              {f.indep > 0.0005 ? ` (independence would give ${fmtP(f.indep)})` : ""}
            </span>
          ))}
          {g.forbidden.length > MAX_FORBIDDEN && ` and ${g.forbidden.length - MAX_FORBIDDEN} more`}
        </TinyText>
      )}
      {!inForce && <TinyText className="text-accent">The states shown now are not a legal combination of this group.</TinyText>}
    </div>
  );
}

// --- the panel ------------------------------------------------------------------------

export default function WorldPanel({
  model,
  table,
  index,
  marginals,
  world,
  overridden,
  selectedVariables,
  disabled,
  onChoose,
  onChooseMany,
  onReset,
}: WorldPanelProps) {
  const [query, setQuery] = useState("");

  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of model.variables.values()) m.set(v.id, describeVariable(table, index, v).label);
    return m;
  }, [model, table, index]);

  const groups = useMemo(
    () =>
      hetcifComponents(model)
        .filter((c) => c.length > 1)
        .map((c) => groupInfo(model, c, marginals)),
    [model, marginals],
  );

  const census = useMemo(() => {
    let segments = 0;
    let waters = 0;
    let singles = 0;
    for (const v of model.variables.values()) {
      const rows = variableRows(index, v.id);
      const seqs = new Set(rows.map((i) => `${table.chain[i]}|${table.seq[i]}`));
      const water = rows.length > 0 && rows.every((i) => table.compId[i] === "HOH");
      if (water) waters++;
      else if (seqs.size > 1) segments++;
      else singles++;
    }
    return { segments, waters, singles };
  }, [model, index, table]);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: string[] = [];
    for (const v of model.variables.values()) {
      const label = labels.get(v.id)?.toLowerCase() ?? "";
      if (v.id.toLowerCase().includes(q) || label.includes(q)) out.push(v.id);
      if (out.length >= MAX_FOUND) break;
    }
    return out;
  }, [query, model, labels]);

  const listed = useMemo(() => {
    const out = [...selectedVariables];
    for (const v of found) if (!out.includes(v)) out.push(v);
    for (const v of overridden) if (!out.includes(v)) out.push(v);
    return out;
  }, [selectedVariables, found, overridden]);

  const nVars = model.variables.size;
  const nTables = model.tables.size;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SectionLabel>World</SectionLabel>
          <SwitchButton pressed={overridden.size === 0} disabled={disabled} onClick={onReset}>
            top world
          </SwitchButton>
          {overridden.size > 0 && (
            <TinyText>
              {overridden.size} variable{overridden.size === 1 ? "" : "s"} moved
            </TinyText>
          )}
        </div>
        <TinyText>
          The file names {nVars} state variables: {census.segments} backbone segments (several residues that move as one unit),{" "}
          {census.singles} single residues and {census.waters} partial waters
          {nTables ? `, and ${nTables} conditional table${nTables === 1 ? "" : "s"} saying how some of them depend on others` : ""}. A world is
          one state for every variable, and the 3D view shows exactly one: by default the most probable world
          {groups.length ? " of each correlated group" : ""}, with every other variable at its most probable state. Moving a variable here
          hides the atoms of its other states; expanded residues (selection actions) show every conformer regardless.
        </TinyText>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <GroupLabel>Correlated groups</GroupLabel>
          {groups.map((g) => (
            <GroupCard
              key={g.variables.join("+")}
              g={g}
              labels={labels}
              marginals={marginals}
              world={world}
              disabled={disabled}
              onChooseMany={onChooseMany}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <GroupLabel>Variables</GroupLabel>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="find: 102, A97, Arg, water"
            className="w-40 rounded border border-line bg-white/70 px-1.5 py-px text-[10.5px] text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
            aria-label="find a variable by id, residue number or residue name"
          />
        </div>
        {listed.length ? (
          listed.map((vid) => {
            const v = model.variables.get(vid);
            return v ? (
              <VariableCard
                key={vid}
                v={v}
                model={model}
                table={table}
                index={index}
                marginals={marginals}
                world={world}
                moved={overridden.has(vid)}
                disabled={disabled}
                onChoose={onChoose}
              />
            ) : null;
          })
        ) : (
          <TinyText>Select a residue in the 3D view or the lanes, or type into the box, to see its variables and move their states.</TinyText>
        )}
        {query && found.length >= MAX_FOUND && <TinyText>first {MAX_FOUND} matches shown; narrow the search</TinyText>}
      </div>
    </div>
  );
}
