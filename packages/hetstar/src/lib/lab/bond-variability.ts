import { makeTrack, type Track } from "@dynamic-pdb/hetkit/metrics";
import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import { bondKey, isWaterEnd, type BondPair } from "../molstar/interactions";

export interface MemberBondRecord {
  pair: BondPair;
  /** indices of the ensemble members the bond is present in */
  members: number[];
}

/** Per residue: the bonds touching it that are not invariant, missing under at least one
 * conformer of their residues or absent in some ensemble members (bonds only other members
 * form are counted once the member pass has delivered `memberBonds`). */
export function bondVariabilityTrack(
  table: AtomTable,
  bonds: readonly BondPair[],
  confDependent: (pair: BondPair) => boolean,
  memberBonds: ReadonlyMap<string, MemberBondRecord> | null,
  memberCount: number,
): Track {
  const variable = new Map<string, BondPair>();
  for (const pair of bonds) if (confDependent(pair)) variable.set(bondKey(pair), pair);
  if (memberBonds) {
    for (const [key, record] of memberBonds) {
      if (record.members.length < memberCount && !variable.has(key)) variable.set(key, record.pair);
    }
  }
  const counts = new Map<string, number>();
  // water contacts count on their polymer partner only: a water's chain|seq key could
  // collide with a polymer residue's auth numbering
  for (const pair of variable.values()) {
    for (const end of [pair.a, pair.b]) {
      if (isWaterEnd(end)) continue;
      const key = `${end.chain}|${end.seq}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const values = new Float32Array(table.residues.length);
  table.residues.forEach((residue, i) => {
    values[i] = counts.get(`${residue.ref.chain}|${residue.ref.seq}`) ?? 0;
  });
  return makeTrack(
    "bond-variability",
    "residue",
    table.residues.map((residue) => residue.ref),
    values,
    { unit: "bonds" },
  );
}
