import type { AtomTable } from "./atoms";
import type { MolCifBlock, MolCifFile } from "./cif";
import { normValue } from "./cif";
import type { AltSelector, AtomKey } from "./het-ext";
import { matchesSelector } from "./het-ext";

// The hetcif categories (~/dev/hetcif, docs/format.md), read with the same semantics as
// the Python package there:
//   _hetcif_variable         a state variable: a finite set of alternatives for one atom set
//   _hetcif_state            its states, with p when the variable owns its distribution
//   _hetcif_member           ATOM_SITE selectors per state (chain, residue range, altloc, atom)
//   _hetcif_table            P(child state | parent states); rows indexed by parent tuples
//   _hetcif_table_parent / _hetcif_table_condition / _hetcif_table_entry
// A world is one state per variable; its probability is the product over variables of the
// variable's own p or of the table row its parents select. Marginals are enumerated per
// connected component of the parent graph. Rules (partition, one owner) are the Python
// validator's business; this reader trusts the file.

export interface HetcifState {
  id: string;
  /** own probability; null when a table owns the variable */
  p: number | null;
  members: AltSelector[];
  details: string | null;
}

export interface HetcifVariable {
  id: string;
  kind: string | null;
  provenance: string | null;
  details: string | null;
  states: HetcifState[];
}

export interface HetcifTableRow {
  id: string;
  /** parent variable id -> parent state id; empty = the default row */
  condition: Record<string, string>;
  /** child state id -> probability */
  p: Record<string, number>;
}

export interface HetcifTable {
  id: string;
  child: string;
  parents: string[];
  rows: HetcifTableRow[];
  provenance: string | null;
  details: string | null;
}

export interface HetcifModel {
  version: string;
  details: string | null;
  variables: Map<string, HetcifVariable>;
  tables: Map<string, HetcifTable>;
}

/** one state per variable (ids), with the joint probability */
export interface HetcifWorld {
  states: Record<string, string>;
  p: number;
}

export function parseHetcif(file: MolCifFile, blockIndex = 0): HetcifModel | null {
  const block = file.blocks[blockIndex];
  if (!block) return null;
  const vcat = block.categories["hetcif_variable"];
  if (!vcat || vcat.rowCount === 0) return null;

  const hdr = block.categories["hetcif"];
  const model: HetcifModel = {
    version: normValue(hdr?.getField("version")?.str(0)) || "0.1",
    details: normValue(hdr?.getField("details")?.str(0)) || null,
    variables: new Map(),
    tables: new Map(),
  };

  const vId = vcat.getField("id");
  const vKind = vcat.getField("kind");
  const vProv = vcat.getField("provenance");
  const vDet = vcat.getField("details");
  for (let r = 0; r < vcat.rowCount; r++) {
    const id = normValue(vId?.str(r));
    if (!id) continue;
    model.variables.set(id, {
      id,
      kind: normValue(vKind?.str(r)) || null,
      provenance: normValue(vProv?.str(r)) || null,
      details: normValue(vDet?.str(r)) || null,
      states: [],
    });
  }

  const scat = block.categories["hetcif_state"];
  if (scat) {
    const sVar = scat.getField("variable_id");
    const sId = scat.getField("id");
    const sP = scat.getField("p");
    const sDet = scat.getField("details");
    for (let r = 0; r < scat.rowCount; r++) {
      const v = model.variables.get(normValue(sVar?.str(r)));
      if (!v) continue;
      const pRaw = normValue(sP?.str(r));
      v.states.push({
        id: normValue(sId?.str(r)),
        p: pRaw ? Number(pRaw) : null,
        members: [],
        details: normValue(sDet?.str(r)) || null,
      });
    }
  }

  const mcat = block.categories["hetcif_member"];
  if (mcat) {
    const mVar = mcat.getField("variable_id");
    const mState = mcat.getField("state_id");
    const mChain = mcat.getField("auth_asym_id");
    const mStart = mcat.getField("auth_seq_id_start");
    const mEnd = mcat.getField("auth_seq_id_end");
    const mAlt = mcat.getField("label_alt_id");
    const mAtom = mcat.getField("label_atom_id");
    for (let r = 0; r < mcat.rowCount; r++) {
      const v = model.variables.get(normValue(mVar?.str(r)));
      const s = v?.states.find((x) => x.id === normValue(mState?.str(r)));
      if (!s) continue;
      const start = mStart?.int(r) ?? 0;
      const endRaw = normValue(mEnd?.str(r));
      s.members.push({
        chain: normValue(mChain?.str(r)),
        seqStart: start,
        seqEnd: endRaw ? Number(endRaw) : start,
        altId: normValue(mAlt?.str(r)),
        atomId: normValue(mAtom?.str(r)) || null,
      });
    }
  }

  const tcat = block.categories["hetcif_table"];
  if (tcat) {
    const tId = tcat.getField("id");
    const tChild = tcat.getField("child_variable_id");
    const tProv = tcat.getField("provenance");
    const tDet = tcat.getField("details");
    for (let r = 0; r < tcat.rowCount; r++) {
      const id = normValue(tId?.str(r));
      if (!id) continue;
      model.tables.set(id, {
        id,
        child: normValue(tChild?.str(r)),
        parents: [],
        rows: [],
        provenance: normValue(tProv?.str(r)) || null,
        details: normValue(tDet?.str(r)) || null,
      });
    }
    const pcat = block.categories["hetcif_table_parent"];
    if (pcat) {
      const pT = pcat.getField("table_id");
      const pV = pcat.getField("parent_variable_id");
      for (let r = 0; r < pcat.rowCount; r++) model.tables.get(normValue(pT?.str(r)))?.parents.push(normValue(pV?.str(r)));
    }
    const rowOf = (t: HetcifTable, rid: string): HetcifTableRow => {
      let row = t.rows.find((x) => x.id === rid);
      if (!row) {
        row = { id: rid, condition: {}, p: {} };
        t.rows.push(row);
      }
      return row;
    };
    const ccat = block.categories["hetcif_table_condition"];
    if (ccat) {
      const cT = ccat.getField("table_id");
      const cR = ccat.getField("row_id");
      const cV = ccat.getField("parent_variable_id");
      const cS = ccat.getField("parent_state_id");
      for (let r = 0; r < ccat.rowCount; r++) {
        const t = model.tables.get(normValue(cT?.str(r)));
        if (!t) continue;
        rowOf(t, normValue(cR?.str(r))).condition[normValue(cV?.str(r))] = normValue(cS?.str(r));
      }
    }
    const ecat = block.categories["hetcif_table_entry"];
    if (ecat) {
      const eT = ecat.getField("table_id");
      const eR = ecat.getField("row_id");
      const eS = ecat.getField("child_state_id");
      const eP = ecat.getField("p");
      for (let r = 0; r < ecat.rowCount; r++) {
        const t = model.tables.get(normValue(eT?.str(r)));
        if (!t) continue;
        rowOf(t, normValue(eR?.str(r))).p[normValue(eS?.str(r))] = Number(normValue(eP?.str(r)) || 0);
      }
    }
  }
  return model;
}

// --- structure --------------------------------------------------------------------

export function tableFor(model: HetcifModel, child: string): HetcifTable | null {
  for (const t of model.tables.values()) if (t.child === child) return t;
  return null;
}

export function parentsOf(model: HetcifModel, vid: string): string[] {
  return tableFor(model, vid)?.parents ?? [];
}

/** Connected components of the undirected parent graph, each in file order. */
export function components(model: HetcifModel): string[][] {
  const order = [...model.variables.keys()];
  const adj = new Map<string, Set<string>>(order.map((v) => [v, new Set<string>()]));
  for (const t of model.tables.values()) {
    for (const p of t.parents) {
      if (adj.has(p) && adj.has(t.child)) {
        adj.get(p)!.add(t.child);
        adj.get(t.child)!.add(p);
      }
    }
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const v of order) {
    if (seen.has(v)) continue;
    const comp: string[] = [];
    const stack = [v];
    seen.add(v);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const y of adj.get(x)!) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    comp.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    out.push(comp);
  }
  return out;
}

function topological(model: HetcifModel, vids: string[]): string[] {
  const remaining = new Set(vids);
  const out: string[] = [];
  while (remaining.size) {
    const ready = vids.filter((v) => remaining.has(v) && parentsOf(model, v).every((p) => !remaining.has(p)));
    if (!ready.length) throw new Error(`hetcif: cycle among ${[...remaining].join(", ")}`);
    for (const v of ready) { out.push(v); remaining.delete(v); }
  }
  return out;
}

function rowFor(t: HetcifTable, assignment: Record<string, string>): HetcifTableRow | null {
  let dflt: HetcifTableRow | null = null;
  for (const r of t.rows) {
    const keys = Object.keys(r.condition);
    if (!keys.length) { dflt = r; continue; }
    if (keys.every((k) => assignment[k] === r.condition[k])) return r;
  }
  return dflt;
}

// --- probabilities ----------------------------------------------------------------

export function worldCount(model: HetcifModel, vids: string[]): number {
  let n = 1;
  for (const v of vids) n *= Math.max(1, model.variables.get(v)?.states.length ?? 1);
  return n;
}

/** Every world of positive probability over `vids` (default: every variable), parents first. */
export function worlds(model: HetcifModel, vids?: string[], budget = 1_000_000): HetcifWorld[] {
  const ids = vids ?? [...model.variables.keys()];
  if (worldCount(model, ids) > budget) throw new Error(`hetcif: ${worldCount(model, ids)} worlds exceed the budget ${budget}`);
  const order = topological(model, ids);
  const out: HetcifWorld[] = [];
  const rec = (i: number, assignment: Record<string, string>, p: number) => {
    if (i === order.length) { out.push({ states: { ...assignment }, p }); return; }
    const v = model.variables.get(order[i])!;
    const t = tableFor(model, v.id);
    let dist: Record<string, number>;
    if (!t) {
      dist = {};
      for (const s of v.states) dist[s.id] = s.p ?? 0;
    } else {
      dist = rowFor(t, assignment)?.p ?? {};
    }
    for (const s of v.states) {
      const ps = dist[s.id] ?? 0;
      if (ps <= 0) continue;
      assignment[v.id] = s.id;
      rec(i + 1, assignment, p * ps);
      delete assignment[v.id];
    }
  };
  rec(0, {}, 1);
  return out;
}

/** P(variable = state) for every state, keyed `${variable}|${state}`. */
export function marginals(model: HetcifModel, budget = 1_000_000): Map<string, number> {
  const out = new Map<string, number>();
  for (const comp of components(model)) {
    for (const v of comp) for (const s of model.variables.get(v)!.states) out.set(`${v}|${s.id}`, 0);
    for (const w of worlds(model, comp, budget)) {
      for (const [v, s] of Object.entries(w.states)) out.set(`${v}|${s}`, (out.get(`${v}|${s}`) ?? 0) + w.p);
    }
  }
  return out;
}

/** The most probable world per component, stitched together. */
export function topWorld(model: HetcifModel): Record<string, string> {
  const choice: Record<string, string> = {};
  for (const comp of components(model)) {
    let best: HetcifWorld | null = null;
    for (const w of worlds(model, comp)) if (!best || w.p > best.p) best = w;
    if (best) Object.assign(choice, best.states);
  }
  return choice;
}

// --- atoms ------------------------------------------------------------------------

/** atom_site rows per (variable, state) and variables per residue, built in one pass. */
export interface HetcifRowIndex {
  /** variable id -> state id -> sorted row indices */
  byVariable: Map<string, Map<string, number[]>>;
  /** residueKey (chain|seq|ins) -> variable ids touching it, in file order */
  byResidue: Map<string, string[]>;
}

/**
 * Selectors are indexed by residue first (one entry per residue of each range), so the pass
 * over the atom table tests each atom only against the selectors of its own residue.
 */
export function buildRowIndex(table: AtomTable, model: HetcifModel): HetcifRowIndex {
  const candidates = new Map<string, { vid: string; sid: string; sel: AltSelector }[]>();
  for (const v of model.variables.values()) {
    for (const s of v.states) {
      for (const sel of s.members) {
        for (let seq = sel.seqStart; seq <= sel.seqEnd; seq++) {
          const k = `${sel.chain}|${seq}`;
          const list = candidates.get(k) ?? [];
          list.push({ vid: v.id, sid: s.id, sel });
          candidates.set(k, list);
        }
      }
    }
  }
  const byVariable = new Map<string, Map<string, number[]>>();
  for (const v of model.variables.values()) byVariable.set(v.id, new Map(v.states.map((s) => [s.id, [] as number[]])));
  const byResidue = new Map<string, string[]>();
  const order = [...model.variables.keys()];
  for (let i = 0; i < table.count; i++) {
    const list = candidates.get(`${table.chain[i]}|${table.seq[i]}`);
    if (!list) continue;
    const key = rowKey(table, i);
    const resKey = `${table.chain[i]}|${table.seq[i]}|${table.ins[i]}`;
    for (const c of list) {
      if (!matchesSelector(c.sel, key)) continue;
      const rows = byVariable.get(c.vid)!.get(c.sid)!;
      if (rows[rows.length - 1] !== i) rows.push(i);
      const vs = byResidue.get(resKey) ?? [];
      if (!vs.includes(c.vid)) {
        vs.push(c.vid);
        vs.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        byResidue.set(resKey, vs);
      }
    }
  }
  return { byVariable, byResidue };
}

function rowKey(table: AtomTable, i: number): AtomKey {
  return { chain: table.chain[i], seq: table.seq[i], altId: table.altId[i], atomId: table.atomName[i] };
}

/** atom_site row indices of each state of a variable. */
export function stateRows(index: HetcifRowIndex, vid: string): Map<string, number[]> {
  return index.byVariable.get(vid) ?? new Map();
}

/**
 * The atom rows a world hides: for every variable, the rows of its non-chosen states minus
 * the rows of the chosen state (a row shared by several states stays when its chosen state
 * holds it). Variables absent from `choice` hide nothing.
 */
export function hiddenRowsForWorld(index: HetcifRowIndex, choice: Record<string, string>): number[] {
  const hidden = new Set<number>();
  for (const [vid, rows] of index.byVariable) {
    const chosen = choice[vid];
    if (chosen === undefined) continue;
    const keep = new Set(rows.get(chosen) ?? []);
    for (const [sid, list] of rows) {
      if (sid === chosen) continue;
      for (const i of list) if (!keep.has(i)) hidden.add(i);
    }
  }
  return [...hidden].sort((a, b) => a - b);
}

/**
 * Atom rows as selectors, compressed: a (chain, residue, altloc) group whose every row is in
 * the set becomes one whole-residue selector, anything else one selector per atom.
 */
export function rowsToSelectors(table: AtomTable, rows: number[]): AltSelector[] {
  const set = new Set(rows);
  const groups = new Map<string, number[]>(); // chain|seq|alt -> all table rows of that group
  for (let i = 0; i < table.count; i++) {
    const k = `${table.chain[i]}|${table.seq[i]}|${table.altId[i]}`;
    const list = groups.get(k) ?? [];
    list.push(i);
    groups.set(k, list);
  }
  const out: AltSelector[] = [];
  const done = new Set<string>();
  for (const i of rows) {
    const k = `${table.chain[i]}|${table.seq[i]}|${table.altId[i]}`;
    if (done.has(k)) continue;
    done.add(k);
    const all = groups.get(k)!;
    if (all.every((j) => set.has(j))) {
      out.push({ chain: table.chain[i], seqStart: table.seq[i], seqEnd: table.seq[i], altId: table.altId[i], atomId: null });
    } else {
      for (const j of all) if (set.has(j)) {
        out.push({ chain: table.chain[j], seqStart: table.seq[j], seqEnd: table.seq[j], altId: table.altId[j], atomId: table.atomName[j] });
      }
    }
  }
  return out;
}
