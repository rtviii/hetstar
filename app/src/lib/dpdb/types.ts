// Normalized description of one Dynamic PDB entry as the compare lab consumes it: which
// coordinate files exist, what role each plays, and where the structure factors live.
// Produced either from the live catalogue (lib/dpdb/client.ts) or from the bundled rows in
// lib/lab/entries.ts (lib/dpdb/resolve.ts), so the loader never cares which.

export type ModelRole = "deposited" | "qfit" | "rerefined" | "ensemble" | "other";
export type ModelFormat = "cif" | "pdb";
export type MetricKey = "r_work" | "r_free" | "clashscore" | "ramachandran_outliers";

export interface ManifestModel {
  /** dpdb model id (dpdb_xxxxxxxx_m_NNN), or "<localId>:<role>" for bundled rows */
  id: string;
  role: ModelRole;
  /** catalogue title verbatim ("qFit model", "Deposited model", ...) */
  title: string;
  /** null when the catalogue lists the model but its artifacts were not fetched (roles this pass does not load) */
  format: ModelFormat | null;
  /** the published location (S3 or RCSB), never the proxied form; see toFetchableUrl */
  url: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  /** "PHENIX 2.0_5824" from the artifact run, when the catalogue records one */
  software: string | null;
  metrics: Partial<Record<MetricKey, number>>;
  /** prose override for provenance (the bundled rows carry their own) */
  note?: string;
}

/** a model whose coordinate file is known */
export type LoadableModel = ManifestModel & { format: ModelFormat; url: string };

export interface EntryManifest {
  /** dpdb entry id, or the bundled id (7A1X) */
  id: string;
  pdbId: string;
  title: string;
  resolution: number | null;
  source: "local" | "dpdb";
  models: ManifestModel[];
  sf: { url: string; sizeBytes: number | null; note: string };
}

export const ROLE_LABELS: Record<ModelRole, string> = {
  deposited: "deposited",
  qfit: "qFit multiconformer",
  rerefined: "re-refined",
  ensemble: "ensemble",
  other: "model",
};

function loadable(m: EntryManifest, x: ManifestModel): LoadableModel {
  if (!x.url || !x.format) throw new Error(`${m.pdbId}: no coordinate file listed for "${x.title}"`);
  if (x.format !== "cif") throw new Error(`${m.pdbId}: "${x.title}" is PDB format; only CIF is supported yet`);
  return x as LoadableModel;
}

/** The A/B pair this pass renders: qFit as A, deposited as B. Both must be CIF. */
export function pickPair(m: EntryManifest): { a: LoadableModel; b: LoadableModel } {
  const a = m.models.find((x) => x.role === "qfit");
  const b = m.models.find((x) => x.role === "deposited");
  if (!a) throw new Error(`${m.pdbId} has no qFit model in the Dynamic PDB catalogue`);
  if (!b) throw new Error(`${m.pdbId} has no deposited model in the Dynamic PDB catalogue`);
  return { a: loadable(m, a), b: loadable(m, b) };
}
