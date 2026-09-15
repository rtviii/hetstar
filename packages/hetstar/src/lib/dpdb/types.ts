// Normalized description of one Dynamic PDB entry as the viewer consumes it: which
// coordinate files exist, what role each plays, and where the structure factors live.
// Produced either from the live catalogue (lib/dpdb/client.ts) or from the RCSB example rows in
// lib/lab/entries.ts (lib/dpdb/resolve.ts), so the loader never cares which.

export type ModelRole = "deposited" | "qfit" | "rerefined" | "ensemble" | "other";
export type ModelFormat = "cif" | "pdb";
export type MetricKey = "r_work" | "r_free" | "clashscore" | "ramachandran_outliers";

export interface ManifestModel {
  /** dpdb model id (dpdb_xxxxxxxx_m_NNN), or "<exampleId>:<role>" for RCSB example rows */
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
  /** prose override for provenance (the RCSB example rows carry their own) */
  note?: string;
}

/** a model whose coordinate file is known */
export type LoadableModel = ManifestModel & { format: ModelFormat; url: string };

/** landing-page facts the catalogue's entry response already carries */
export interface EntryCatalogueInfo {
  details: string | null;
  method: string | null;
  spaceGroup: string | null;
  publishedAt: string | null;
  growthPh: number | null;
  growthTempK: number | null;
  entities: {
    entityId: string | null;
    description: string | null;
    organism: string | null;
    uniprot: string | null;
  }[];
}

export interface EntryManifest {
  /** dpdb entry id, or the example's PDB id */
  id: string;
  pdbId: string;
  title: string;
  resolution: number | null;
  source: "rcsb" | "dpdb";
  /** only for source "dpdb"; example rows derive their facts from the CIF headers */
  catalogue?: EntryCatalogueInfo;
  models: ManifestModel[];
  /** null for entries without map coefficients (NMR ensembles): no density lab */
  sf: { url: string; sizeBytes: number | null; note: string } | null;
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

/**
 * The A/B pair this pass renders: qFit as A and deposited as B when both exist; an
 * ensemble (or the deposited model alone) as A with no B otherwise. All CIF.
 */
export function pickPair(m: EntryManifest): { a: LoadableModel; b: LoadableModel | null } {
  const a =
    m.models.find((x) => x.role === "qfit") ??
    m.models.find((x) => x.role === "ensemble") ??
    m.models.find((x) => x.role === "deposited");
  if (!a) throw new Error(`${m.pdbId} has no loadable model (qFit, ensemble or deposited)`);
  const b = a.role === "deposited" ? null : (m.models.find((x) => x.role === "deposited") ?? null);
  return { a: loadable(m, a), b: b ? loadable(m, b) : null };
}
