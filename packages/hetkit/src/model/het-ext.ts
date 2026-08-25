import type { AtomTable } from "./atoms";
import type { MolCifBlock, MolCifFile } from "./cif";
import { normValue } from "./cif";

// Heterogeneity networks parsed from the proposed extension categories
// (mmcif_pdbx_v50_het_ext.dic in the mmcif-browser repo):
//   _pdbx_alt_groups              -- membership: which atom_site rows make up each named network
//   _pdbx_heterogeneity_hierarchy -- which networks exclude one another (coexistence groups)
//   _pdbx_het_state               -- the joint: combinations that occur, with their occupancies
//   _pdbx_het_state_members       -- which networks make up each state
//   _pdbx_state_coexistence       -- optional NOT exclusions between networks
// Ported from app/src/lib/molstar/het.ts, with the occupancy assignment rewritten to use
// a one-pass atom index instead of a full atom_site rescan per membership row.
// These categories are OPTIONAL: qFit output does not carry them today, so extensions
// is null for the entire Dynamic PDB corpus until the proposal lands.

export interface AltSelector {
  chain: string; // auth_asym_id
  seqStart: number; // auth_seq_id_start
  seqEnd: number; // auth_seq_id_end
  altId: string; // label_alt_id
  atomId: string | null; // label_atom_id, or null when '.' (all atoms in the range)
}

export interface HetNetwork {
  id: string;
  members: AltSelector[];
  coexistenceGroupId: string | null;
  /** marginal occupancy, read off a member atom in atom_site */
  occupancy: number | null;
}

export interface HetExclusion {
  id: string;
  rule: string; // always "NOT"
  a: string;
  b: string;
}

export interface HetBondEnd {
  chain: string;
  seq: number;
  comp: string;
  atomId: string;
  altId: string | null;
}

export interface HetBond {
  id: string;
  type: string;
  a: HetBondEnd;
  b: HetBondEnd;
  distance: number | null;
  networks: string[];
}

export interface HetState {
  id: string;
  networks: string[];
  label: string;
  probability: number | null;
  bundleId: string | null;
  provenance: string | null;
  details: string | null;
}

export type StateSource = "stated" | "independent";

export interface HetModel {
  networks: HetNetwork[];
  byId: Map<string, HetNetwork>;
  exclusions: HetExclusion[];
  states: HetState[];
  stateSource: StateSource;
  bonds: HetBond[];
}

export interface AtomKey {
  chain: string;
  seq: number;
  altId: string;
  atomId: string;
}

// The single definition of network membership; queries, source-line indexing, and
// occupancy assignment must all agree with it.
export function matchesSelector(m: AltSelector, a: AtomKey): boolean {
  return (
    a.chain === m.chain &&
    a.seq >= m.seqStart &&
    a.seq <= m.seqEnd &&
    a.altId === m.altId &&
    (!m.atomId || a.atomId === m.atomId)
  );
}

export function parseHeterogeneity(file: MolCifFile, table: AtomTable | null, blockIndex = 0): HetModel | null {
  const block = file.blocks[blockIndex];
  if (!block) return null;
  const alt = block.categories["pdbx_alt_groups"];
  if (!alt || alt.rowCount === 0) return null;

  const gId = alt.getField("alt_group_id");
  const gChain = alt.getField("auth_asym_id");
  const gStart = alt.getField("auth_seq_id_start");
  const gEnd = alt.getField("auth_seq_id_end");
  const gAlt = alt.getField("label_alt_id");
  const gAtom = alt.getField("label_atom_id");

  const byId = new Map<string, HetNetwork>();
  for (let r = 0; r < alt.rowCount; r++) {
    const id = normValue(gId?.str(r));
    if (!id || id === "base") continue;
    const start = gStart?.int(r) ?? 0;
    const endRaw = gEnd?.int(r);
    const sel: AltSelector = {
      chain: normValue(gChain?.str(r)),
      seqStart: start,
      seqEnd: endRaw == null || Number.isNaN(endRaw) ? start : endRaw,
      altId: normValue(gAlt?.str(r)),
      atomId: normValue(gAtom?.str(r)) || null,
    };
    const net = byId.get(id) ?? { id, members: [], coexistenceGroupId: null, occupancy: null };
    net.members.push(sel);
    byId.set(id, net);
  }
  if (byId.size === 0) return null;

  const hier = block.categories["pdbx_heterogeneity_hierarchy"];
  if (hier) {
    const hId = hier.getField("alt_group_id");
    const hCoex = hier.getField("coexistence_group_id");
    for (let r = 0; r < hier.rowCount; r++) {
      const net = byId.get(normValue(hId?.str(r)));
      if (!net) continue;
      net.coexistenceGroupId = normValue(hCoex?.str(r)) || null;
    }
  }

  assignOccupancies(table, byId);

  const exclusions: HetExclusion[] = [];
  const excl = block.categories["pdbx_state_coexistence"];
  if (excl) {
    const eId = excl.getField("id");
    const eRule = excl.getField("rule");
    const eA = excl.getField("alt_group_id");
    const eB = excl.getField("alt_group_ids");
    for (let r = 0; r < excl.rowCount; r++) {
      exclusions.push({
        id: normValue(eId?.str(r)) || String(r + 1),
        rule: normValue(eRule?.str(r)) || "NOT",
        a: normValue(eA?.str(r)),
        b: normValue(eB?.str(r)),
      });
    }
  }

  const networks = [...byId.values()];
  // A file that states its joint distribution is believed over anything derivable:
  // deriving would assume the independence the state table exists to deny.
  const stated = readStates(block, byId);
  return {
    networks,
    byId,
    exclusions,
    states: stated ?? enumerateStates(networks, exclusions),
    stateSource: stated ? "stated" : "independent",
    bonds: readBonds(block, networks),
  };
}

export function selectorsFor(model: HetModel, networkId: string): AltSelector[] {
  return model.byId.get(networkId)?.members ?? [];
}

// --- occupancy assignment via a one-pass index over the atom table ---
// Replaces the O(networks x members x atom_site rows) rescans of the original: one pass
// builds two lookup maps, then each member resolves in O(range length) at worst.
function assignOccupancies(table: AtomTable | null, byId: Map<string, HetNetwork>) {
  if (!table) return;
  const byAtom = new Map<string, number>(); // chain|seq|alt|atom -> occupancy
  const firstOfResidueAlt = new Map<string, number>(); // chain|seq|alt -> occupancy of first row
  for (let i = 0; i < table.count; i++) {
    const alt = table.altId[i];
    const resKey = `${table.chain[i]}|${table.seq[i]}|${alt}`;
    const atomFullKey = `${resKey}|${table.atomName[i]}`;
    if (!byAtom.has(atomFullKey)) byAtom.set(atomFullKey, table.occupancy[i]);
    if (!firstOfResidueAlt.has(resKey)) firstOfResidueAlt.set(resKey, table.occupancy[i]);
  }
  for (const net of byId.values()) {
    let occ: number | null = null;
    for (const m of net.members) {
      for (let seq = m.seqStart; seq <= m.seqEnd && occ == null; seq++) {
        const base = `${m.chain}|${seq}|${m.altId}`;
        const hit = m.atomId ? byAtom.get(`${base}|${m.atomId}`) : firstOfResidueAlt.get(base);
        if (hit !== undefined && !Number.isNaN(hit)) occ = hit;
      }
      if (occ != null) break;
    }
    net.occupancy = occ;
  }
}

function readBonds(block: MolCifBlock, networks: HetNetwork[]): HetBond[] {
  const sc = block.categories["struct_conn"];
  if (!sc || sc.rowCount === 0) return [];
  const f = (name: string) => sc.getField(name);
  const end = (r: number, n: 1 | 2): HetBondEnd | null => {
    const chain = normValue(f(`ptnr${n}_auth_asym_id`)?.str(r));
    const seq = f(`ptnr${n}_auth_seq_id`)?.int(r);
    const atomId = normValue(f(`ptnr${n}_label_atom_id`)?.str(r));
    if (!chain || seq == null || Number.isNaN(seq) || !atomId) return null;
    return {
      chain,
      seq,
      comp: normValue(f(`ptnr${n}_auth_comp_id`)?.str(r)) || normValue(f(`ptnr${n}_label_comp_id`)?.str(r)),
      atomId,
      altId: normValue(f(`pdbx_ptnr${n}_label_alt_id`)?.str(r)) || null,
    };
  };

  const out: HetBond[] = [];
  for (let r = 0; r < sc.rowCount; r++) {
    const a = end(r, 1);
    const b = end(r, 2);
    if (!a || !b) continue;
    const dist = f("pdbx_dist_value")?.float(r);
    const owners = new Set<string>();
    for (const e of [a, b]) {
      if (!e.altId) continue; // a single-conformer partner belongs to base, not to a network
      const key: AtomKey = { chain: e.chain, seq: e.seq, altId: e.altId, atomId: e.atomId };
      for (const net of networks) {
        if (net.members.some((m) => matchesSelector(m, key))) owners.add(net.id);
      }
    }
    out.push({
      id: normValue(f("id")?.str(r)) || String(r + 1),
      type: normValue(f("conn_type_id")?.str(r)) || "covale",
      a,
      b,
      distance: dist == null || Number.isNaN(dist) ? null : dist,
      networks: [...owners],
    });
  }
  return out;
}

function readStates(block: MolCifBlock, byId: Map<string, HetNetwork>): HetState[] | null {
  const st = block.categories["pdbx_het_state"];
  if (!st || st.rowCount === 0) return null;

  const membersOf = new Map<string, string[]>();
  const mem = block.categories["pdbx_het_state_members"];
  if (mem) {
    const mState = mem.getField("state_id");
    const mNet = mem.getField("alt_group_id");
    for (let r = 0; r < mem.rowCount; r++) {
      const sid = normValue(mState?.str(r));
      const nid = normValue(mNet?.str(r));
      if (!sid || !nid || !byId.has(nid)) continue;
      (membersOf.get(sid) ?? membersOf.set(sid, []).get(sid)!).push(nid);
    }
  }

  const sId = st.getField("id");
  const sBundle = st.getField("bundle_id");
  const sOcc = st.getField("occupancy");
  const sProv = st.getField("provenance");
  const sDetails = st.getField("details");
  const out: HetState[] = [];
  for (let r = 0; r < st.rowCount; r++) {
    const id = normValue(sId?.str(r)) || String(r + 1);
    const nets = membersOf.get(id) ?? [];
    const occ = sOcc?.float(r);
    out.push({
      id,
      networks: nets,
      label: nets.length ? nets.join(" + ") : "base only",
      probability: occ == null || Number.isNaN(occ) ? null : occ,
      bundleId: normValue(sBundle?.str(r)) || null,
      provenance: normValue(sProv?.str(r)) || null,
      details: normValue(sDetails?.str(r)) || null,
    });
  }
  return out.length ? out : null;
}

// A coexistence group is complete when its members' marginals sum to 1; when they sum to
// less, "none of them" is a legal choice carrying the remainder.
const SUM_TOL = 0.02;

function groupSum(members: HetNetwork[]): number | null {
  let sum = 0;
  for (const n of members) {
    if (n.occupancy == null) return null;
    sum += n.occupancy;
  }
  return sum;
}

// Fallback for files with no state table: every combination the coexistence groups allow,
// weighted as though the groups were independent, then pruned by NOT exclusions.
function enumerateStates(networks: HetNetwork[], exclusions: HetExclusion[]): HetState[] {
  const groups = new Map<string, HetNetwork[]>();
  for (const n of networks) {
    const g = n.coexistenceGroupId ?? `:${n.id}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(n);
  }

  let combos: { nets: string[]; p: number | null }[] = [{ nets: [], p: 1 }];
  for (const members of groups.values()) {
    const sum = groupSum(members);
    const options: { nets: string[]; p: number | null }[] = members.map((n) => ({
      nets: [n.id],
      p: n.occupancy,
    }));
    if (sum != null && sum < 1 - SUM_TOL) options.push({ nets: [], p: 1 - sum });
    combos = combos.flatMap((c) =>
      options.map((o) => ({
        nets: [...c.nets, ...o.nets],
        p: c.p == null || o.p == null ? null : c.p * o.p,
      })),
    );
  }

  const forbidden = exclusions.filter((e) => e.rule === "NOT" && e.a && e.b);
  return combos
    .filter((c) => {
      const s = new Set(c.nets);
      return !forbidden.some((e) => s.has(e.a) && s.has(e.b));
    })
    .map((c, i) => ({
      id: `state ${i + 1}`,
      networks: c.nets,
      label: c.nets.length ? c.nets.join(" + ") : "base only",
      probability: c.p,
      bundleId: null,
      provenance: null,
      details: null,
    }));
}
