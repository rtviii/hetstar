"use client";
import { Fragment, memo, useMemo } from "react";

import { isHeavy, isPolymerComp, residueKey, type AtomTable, type ChainSequence } from "@dynamic-pdb/hetkit/model";
import { WATER_COMPS } from "@/lib/lab/entries";
import { spanStyle, type LaneModule, type LaneProps, type PositionSpan } from "./types";

// Ligand-contact lane, computed locally from model A: polymer residues with a heavy
// atom within CONTACT_R of any ligand/ion heavy atom, kept PER LIGAND INSTANCE (each
// GDP, MG, ... residue separately). The merged lane draws contiguous runs of the union;
// the "+" toggle on the lane label expands one sub-row per instance. Clicking a run
// selects the whole contiguous range.
// (PDBe's binding_sites endpoints are retired, and a distance criterion on the shown
// model is truer to the coordinates anyway — it follows the selected ensemble member.)

const CONTACT_R = 4.0;
const CONTACT_R2 = CONTACT_R * CONTACT_R;
const COLOR = "#3e8f7a";
const ROW_H = 10;
const LANE_ID = "ligand-contacts";

interface LigandInstance {
  /** residueKey of the ligand residue */
  key: string;
  compId: string;
  /** "GDP A201" */
  label: string;
  /** auth chain -> contacted polymer residueKeys */
  contactKeys: Map<string, Set<string>>;
}

const contactsCache = new WeakMap<AtomTable, LigandInstance[]>();

/** every ligand/ion instance with its contacted residues; O(polymer heavy x ligand heavy), cached per table */
function ligandContacts(table: AtomTable): LigandInstance[] {
  const hit = contactsCache.get(table);
  if (hit) return hit;
  const instances: LigandInstance[] = [];
  const heavyRows: number[][] = [];
  for (const res of table.residues) {
    if (isPolymerComp(res.compId) || WATER_COMPS.has(res.compId)) continue;
    const heavy = res.rows.filter((r) => isHeavy(table, r));
    if (!heavy.length) continue;
    instances.push({
      key: residueKey(res.ref),
      compId: res.compId,
      label: `${res.compId} ${res.ref.chain}${res.ref.seq}${res.ref.ins}`,
      contactKeys: new Map(),
    });
    heavyRows.push(heavy);
  }
  if (instances.length) {
    for (const res of table.residues) {
      if (!isPolymerComp(res.compId)) continue;
      const chain = res.ref.chain;
      const key = residueKey(res.ref);
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if (inst.contactKeys.get(chain)?.has(key)) continue;
        outer: for (const r of res.rows) {
          if (!isHeavy(table, r)) continue;
          const x = table.x[r], y = table.y[r], z = table.z[r];
          for (const l of heavyRows[i]) {
            const dx = x - table.x[l], dy = y - table.y[l], dz = z - table.z[l];
            if (dx * dx + dy * dy + dz * dz <= CONTACT_R2) {
              let set = inst.contactKeys.get(chain);
              if (!set) {
                set = new Set();
                inst.contactKeys.set(chain, set);
              }
              set.add(key);
              break outer;
            }
          }
        }
      }
    }
  }
  const out = instances.filter((inst) => inst.contactKeys.size);
  contactsCache.set(table, out);
  return out;
}

function instancesOnChain(table: AtomTable, chain: ChainSequence): LigandInstance[] {
  return ligandContacts(table).filter((inst) => inst.contactKeys.get(chain.chain)?.size);
}

/** contacted residue keys -> sorted positions -> contiguous position runs */
function runsFor(keys: ReadonlySet<string>, chain: ChainSequence): PositionSpan[] {
  const positions: number[] = [];
  for (const k of keys) {
    const p = chain.posByKey.get(k);
    if (p !== undefined) positions.push(p);
  }
  positions.sort((a, b) => a - b);
  const runs: PositionSpan[] = [];
  for (const p of positions) {
    const last = runs[runs.length - 1];
    if (last && p <= last.end + 1) last.end = p;
    else runs.push({ start: p, end: p });
  }
  return runs;
}

const ContactLaneView = memo(function ContactLaneView({ ctx, onSelectSpan }: LaneProps) {
  const expanded = ctx.expandedLanes.has(LANE_ID);
  const data = useMemo(() => {
    if (!ctx.aTable) return { merged: [] as (PositionSpan & { labels: string[] })[], perInstance: [] as { inst: LigandInstance; runs: PositionSpan[] }[] };
    const instances = instancesOnChain(ctx.aTable, ctx.chain);
    const perInstance = instances.map((inst) => ({
      inst,
      runs: runsFor(inst.contactKeys.get(ctx.chain.chain)!, ctx.chain),
    }));
    // merged: contiguous runs of the union, each titled with the instances it touches
    const byPos = new Map<number, string[]>();
    for (const inst of instances) {
      for (const k of inst.contactKeys.get(ctx.chain.chain)!) {
        const p = ctx.chain.posByKey.get(k);
        if (p === undefined) continue;
        const list = byPos.get(p) ?? [];
        if (!list.includes(inst.label)) list.push(inst.label);
        byPos.set(p, list);
      }
    }
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const merged: (PositionSpan & { labels: string[] })[] = [];
    for (const p of positions) {
      const last = merged[merged.length - 1];
      if (last && p <= last.end + 1) {
        last.end = p;
        for (const l of byPos.get(p)!) if (!last.labels.includes(l)) last.labels.push(l);
      } else {
        merged.push({ start: p, end: p, labels: [...byPos.get(p)!] });
      }
    }
    return { merged, perInstance };
  }, [ctx.aTable, ctx.chain]);

  const run = (span: PositionSpan, title: string, key: number, rowTop?: number) => (
    <span
      key={key}
      className={`absolute cursor-pointer opacity-70 hover:opacity-100 ${rowTop === undefined ? "inset-y-0" : ""}`}
      style={{
        ...spanStyle(span, ctx.chain.length),
        ...(rowTop !== undefined ? { top: rowTop + 1, height: ROW_H - 2 } : null),
        background: COLOR,
        minWidth: 2,
      }}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelectSpan({ start: span.start, end: span.end }, { additive: e.shiftKey });
      }}
    />
  );

  if (!expanded || data.perInstance.length <= 1) {
    return (
      <>
        {data.merged.map((m, i) =>
          run(m, `contacts ${m.labels.join(", ")} (heavy atom within ${CONTACT_R} A); click selects the run`, i),
        )}
      </>
    );
  }
  return (
    <>
      {data.perInstance.map(({ inst, runs }, row) => (
        <Fragment key={inst.key}>
          <span
            className="pointer-events-none absolute left-0.5 z-10 font-mono text-[7.5px] leading-none text-ink-muted"
            style={{ top: row * ROW_H + 2 }}
          >
            {inst.label}
          </span>
          {runs.map((s, i) =>
            run(s, `${inst.label} contacts (heavy atom within ${CONTACT_R} A); click selects the run`, i, row * ROW_H),
          )}
        </Fragment>
      ))}
    </>
  );
});

export const ligandContactLane: LaneModule = {
  id: LANE_ID,
  label: "Ligand contacts",
  description: `polymer residues with a heavy atom within ${CONTACT_R} A of a ligand or ion in model A, per ligand instance; computed from the shown coordinates`,
  defaultOn: false,
  height: (ctx) => {
    const n = ctx.aTable ? instancesOnChain(ctx.aTable, ctx.chain).length : 0;
    const rows = ctx.expandedLanes.has(LANE_ID) && n > 1 ? n : 1;
    return rows * ROW_H + 2;
  },
  unavailable: (ctx) => {
    if (!ctx.aTable) return "load a model";
    if (!ligandContacts(ctx.aTable).length) return "no ligands or ions in model A";
    if (!instancesOnChain(ctx.aTable, ctx.chain).length) return "none on this chain";
    return null;
  },
  expandable: (ctx) => !!ctx.aTable && instancesOnChain(ctx.aTable, ctx.chain).length > 1,
  Component: ContactLaneView,
  readout: (ctx, pos) => {
    if (!ctx.aTable) return null;
    const p = ctx.chain.positions[pos - 1];
    if (!p?.ref) return null;
    const key = residueKey(p.ref);
    const labels = instancesOnChain(ctx.aTable, ctx.chain)
      .filter((inst) => inst.contactKeys.get(ctx.chain.chain)?.has(key))
      .map((inst) => inst.label);
    return labels.length ? `contacts ${labels.join(", ")}` : null;
  },
};
