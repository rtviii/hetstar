// Turns whatever the user typed into an EntryManifest: a bundled row, a dpdb id, or one of
// a few PDB ids we know the dpdb id for.

import { ENTRIES, findEntry, type EntryDef } from "@/lib/lab/entries";
import { fetchEntryManifest } from "./client";
import type { EntryManifest } from "./types";

// Stopgap until the catalogue resolves PDB ids itself (no filter or alias endpoint yet, and
// the site search ignores its query); these were looked up by hand on 2026-09-10.
export const PDB_ALIASES: Record<string, { dpdb: string; sfBytesHint?: number }> = {
  "7APT": { dpdb: "dpdb_kytgultv" },
  "5GQJ": { dpdb: "dpdb_0dn17ijl" },
  "5R8T": { dpdb: "dpdb_eknnmj7a", sfBytesHint: 445e6 }, // PanDDA deposit, unmerged data in the sf-cif
};

export function knownEntryIds(): string[] {
  return [...ENTRIES.map((e) => e.id), ...Object.keys(PDB_ALIASES)];
}

export function manifestFromLocalEntry(def: EntryDef): EntryManifest {
  const blank = { sizeBytes: null, sha256: null, software: null, metrics: {} };
  return {
    id: def.id,
    pdbId: def.id,
    title: def.label,
    resolution: null,
    source: "local",
    models: [
      { id: `${def.id}:qfit`, role: "qfit", title: "qFit model", format: "cif", url: def.qfit.url, note: def.qfit.note, ...blank },
      { id: `${def.id}:deposited`, role: "deposited", title: "Deposited model", format: "cif", url: def.deposited.url, note: def.deposited.note, ...blank },
    ],
    sf: { url: def.sf.url, sizeBytes: Math.round(def.sf.approxMB * 1e6), note: def.sf.note },
  };
}

export async function resolveEntry(input: string): Promise<EntryManifest> {
  const id = input.trim();
  const local = findEntry(id);
  if (local) return manifestFromLocalEntry(local);
  if (/^dpdb_/i.test(id)) return fetchEntryManifest(id.toLowerCase());
  const alias = PDB_ALIASES[id.toUpperCase()];
  if (alias) {
    const m = await fetchEntryManifest(alias.dpdb);
    if (alias.sfBytesHint && m.sf.sizeBytes == null) m.sf.sizeBytes = alias.sfBytesHint;
    return m;
  }
  throw new Error(`unknown entry "${id}": use a dpdb_... id or one of ${knownEntryIds().join(", ")}`);
}
