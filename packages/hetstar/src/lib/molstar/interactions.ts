import { Structure, StructureElement, StructureProperties, Unit } from "molstar/lib/mol-model/structure";
import { computeInteractions } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import type { Interactions } from "molstar/lib/mol-model-props/computed/interactions/interactions";
import { InteractionFlag, interactionTypeLabel } from "molstar/lib/mol-model-props/computed/interactions/common";
import { Features } from "molstar/lib/mol-model-props/computed/interactions/features";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { Task } from "molstar/lib/mol-task";
import { WATER_COMPS } from "../lab/entries";

// Typed non-covalent bonds (H-bond, ionic, pi-stacking, ...) computed client-side with
// Mol*'s interaction engine at its default thresholds — the same path tubulinxyz uses.
// The full edge set is extracted once per structure into residue-pair records; consumers
// filter by the current selection. Each record also carries world-space segments so the
// lab can draw exactly these bonds itself (scene == list by construction).

export interface BondEndInfo {
  chain: string;
  seq: number;
  comp: string;
}

export type Vec3Tuple = [number, number, number];

/** One drawable copy of a bond: a distinct end-feature pair under one altloc pairing. */
export interface BondSegment {
  /** altloc letter at each end; "" = blank/shared */
  altA: string;
  altB: string;
  /** world coords of the end feature centroids (a = pair.a side) */
  a: Vec3Tuple;
  b: Vec3Tuple;
}

export interface BondPair {
  a: BondEndInfo;
  b: BondEndInfo;
  /** Mol*'s label, e.g. "Hydrogen Bond" */
  type: string;
  /**
   * Conformer letters (label_alt_id) under which this contact exists, sorted. Empty means the
   * contact is between altloc-free atoms — present regardless of conformer state.
   */
  alts: string[];
  /** one entry per engine edge copy (per altloc pairing, per distinct feature pair) */
  segments: BondSegment[];
}

export function isWaterEnd(e: BondEndInfo): boolean {
  return WATER_COMPS.has(e.comp);
}

function endKey(e: BondEndInfo): string {
  return `${e.chain}|${e.seq}`;
}

// Mol*'s default distanceMax for the contact types whose features can pool several
// conformers (charged.js). Used to re-test a pooled contact per conformer letter.
const POOLED_DISTANCE_MAX: Record<string, number> = {
  "Ionic Interaction": 5.0,
  "Pi Stacking": 5.5,
  "Cation-Pi Interaction": 6.0,
};

/** Residue-pair + type identity of a bond, stable across ensemble members. */
export function bondKey(p: BondPair): string {
  return `${endKey(p.a)}|${endKey(p.b)}|${p.type}`;
}

async function computeStructureInteractions(ctx: PluginContext, structure: Structure): Promise<Interactions> {
  let interactions: Interactions | undefined;
  await ctx.runTask(
    Task.create("Compute interactions", async (runtime) => {
      interactions = await computeInteractions({ runtime, assetManager: ctx.managers.asset }, structure, {});
    }),
  );
  if (!interactions) throw new Error("interaction computation produced nothing");
  return interactions;
}

/**
 * All residue-pair bonds of the structure: inter-unit contacts (ligand-polymer,
 * chain-chain) plus intra-unit ones (within one chain), water contacts included.
 * Water-water and same-residue contacts are dropped; identical (pair, type) records
 * dedupe to one.
 */
export async function computeBonds(ctx: PluginContext, structure: Structure): Promise<BondPair[]> {
  const interactions = await computeStructureInteractions(ctx, structure);
  const { contacts, unitsContacts, unitsFeatures } = interactions;

  // Mol*'s engine emits one edge per compatible altloc pairing (it rejects atoms with
  // differing non-blank altlocs), so the same residue pair can arrive as an A-copy, a
  // B-copy, etc. Merge those copies into one record, accumulating the letters; a copy
  // between altloc-free atoms marks the pair shared (present in every conformer).
  //
  // Charged-residue features (Arg/Lys/His, Asp/Glu) pool every non-backbone N/O of the
  // residue across ALL altlocs into one feature: one centroid between the conformers, and the
  // engine judges its letter by the first member only. endsAt splits such a feature back
  // into one end per letter (blank members + that letter's members, own centroid), and a
  // split pairing is kept only if some member pair of the two ends is within the type's
  // default distanceMax — the engine's own charged-contact test, applied per conformer.
  type End = BondEndInfo & { alt: string; pos: Vec3Tuple; atoms?: Vec3Tuple[] };
  const merged = new Map<
    string,
    { a: BondEndInfo; b: BondEndInfo; type: string; alts: Set<string>; shared: boolean; segments: Map<string, BondSegment> }
  >();

  const loc = StructureElement.Location.create(structure);
  const v = Vec3();
  const endsAt = (unit: Unit, featureIndex: number): End[] => {
    if (!Unit.isAtomic(unit)) return [];
    const features = unitsFeatures.get(unit.id);
    if (!features) return [];
    const start = features.offsets[featureIndex];
    const stop = features.offsets[featureIndex + 1];
    loc.unit = unit;
    loc.element = unit.elements[features.members[start]];
    const base = {
      chain: StructureProperties.chain.auth_asym_id(loc),
      seq: StructureProperties.residue.auth_seq_id(loc),
      comp: StructureProperties.atom.label_comp_id(loc),
    };
    const byAlt = new Map<string, number[]>();
    for (let i = start; i < stop; i++) {
      loc.element = unit.elements[features.members[i]];
      const alt = StructureProperties.atom.label_alt_id(loc);
      const list = byAlt.get(alt);
      if (list) list.push(features.members[i]);
      else byAlt.set(alt, [features.members[i]]);
    }
    const letters = [...byAlt.keys()].filter(Boolean);
    if (letters.length <= 1) {
      // feature centroid with the unit operator applied — the same endpoint Mol*'s own
      // interactions repr uses (ring centers for pi contacts, symmetry copies placed right)
      Features.setPosition(v, unit, featureIndex as Features.FeatureIndex, features);
      return [{ ...base, alt: letters[0] ?? "", pos: [v[0], v[1], v[2]] }];
    }
    const blank = byAlt.get("") ?? [];
    return letters.map((letter) => {
      const atoms = [...blank, ...byAlt.get(letter)!].map((m): Vec3Tuple => {
        unit.conformation.position(unit.elements[m], v);
        return [v[0], v[1], v[2]];
      });
      const pos: Vec3Tuple = [0, 0, 0];
      for (const p of atoms) for (let k = 0; k < 3; k++) pos[k] += p[k] / atoms.length;
      return { ...base, alt: letter, pos, atoms };
    });
  };

  const withinDistance = (a: End, b: End, max: number) => {
    const pa = a.atoms ?? [a.pos];
    const pb = b.atoms ?? [b.pos];
    const maxSq = max * max;
    return pa.some((p) => pb.some((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 <= maxSq));
  };

  const push = (a: End, b: End, type: string) => {
    if (a.chain === b.chain && a.seq === b.seq) return; // intra-residue
    if (isWaterEnd(a) && isWaterEnd(b)) return; // water-water: noise for this UI
    // canonical end order so the two directions of an edge dedupe together
    const [x, y] = endKey(a) <= endKey(b) ? [a, b] : [b, a];
    const key = `${endKey(x)}|${endKey(y)}|${type}`;
    let rec = merged.get(key);
    if (!rec) {
      rec = {
        a: { chain: x.chain, seq: x.seq, comp: x.comp },
        b: { chain: y.chain, seq: y.seq, comp: y.comp },
        type,
        alts: new Set(),
        shared: false,
        segments: new Map(),
      };
      merged.set(key, rec);
    }
    const letter = a.alt || b.alt; // never differ when both set (pushEdge rejects those pairs)
    if (letter) rec.alts.add(letter);
    else rec.shared = true;
    // position-keyed so the intra-unit mirror folds while bidentate same-type bonds stay distinct
    const segKey = `${x.alt}|${y.alt}|${x.pos.map((n) => n.toFixed(2)).join(",")}|${y.pos.map((n) => n.toFixed(2)).join(",")}`;
    if (!rec.segments.has(segKey)) rec.segments.set(segKey, { altA: x.alt, altB: y.alt, a: x.pos, b: y.pos });
  };

  const pushEdge = (as: End[], bs: End[], type: string) => {
    const split = as.length > 1 || bs.length > 1;
    const max = POOLED_DISTANCE_MAX[type];
    for (const a of as) {
      for (const b of bs) {
        if (a.alt && b.alt && a.alt !== b.alt) continue; // incompatible conformers
        if (split && max !== undefined && !withinDistance(a, b, max)) continue;
        push(a, b, type);
      }
    }
  };

  for (const edge of contacts.edges) {
    if (edge.props.flag === InteractionFlag.Filtered) continue;
    const uA = structure.unitMap.get(edge.unitA);
    const uB = structure.unitMap.get(edge.unitB);
    if (!uA || !uB) continue;
    pushEdge(endsAt(uA, edge.indexA), endsAt(uB, edge.indexB), interactionTypeLabel(edge.props.type));
  }

  for (const unit of structure.units) {
    const g = unitsContacts.get(unit.id);
    if (!g) continue;
    // a/b hold each undirected edge twice (both directions); the merge handles the mirror
    for (let i = 0; i < g.a.length; i++) {
      if (g.edgeProps.flag[i] === InteractionFlag.Filtered) continue;
      pushEdge(endsAt(unit, g.a[i]), endsAt(unit, g.b[i]), interactionTypeLabel(g.edgeProps.type[i]));
    }
  }

  const out: BondPair[] = [];
  for (const rec of merged.values()) {
    out.push({
      a: rec.a,
      b: rec.b,
      type: rec.type,
      alts: rec.shared ? [] : Array.from(rec.alts).sort(),
      segments: Array.from(rec.segments.values()),
    });
  }
  return out;
}
