// Thin client for the Dynamic PDB catalogue (JSON:API at dynamicpdb.com/api/v1).
// The browser cannot call dynamicpdb.com or files.dynamicpdb.com from another origin (the API
// allows only https://dynamicpdb.com, the files host sends no CORS headers), so by default both
// go through the hetstar app's same-origin proxy routes. A host page overrides the bases through
// HetstarViewer's `dpdb` prop: on dynamicpdb.com the API is same-origin at /api/v1, and an empty
// fileProxy fetches artifacts directly once the files host allows that origin.

import type { StoredResidueRow } from "@dynamic-pdb/hetkit/metrics";
import type { EntryCatalogueInfo, EntryManifest, ManifestModel, MetricKey, ModelFormat, ModelRole } from "./types";

export interface DpdbConfig {
  /** JSON:API base, without trailing slash */
  apiBase?: string;
  /** file proxy taking ?u=<artifact uri>; "" fetches artifacts directly */
  fileProxy?: string;
}

const config: Required<DpdbConfig> = { apiBase: "/api/dpdb", fileProxy: "/api/dpdb-file" };

export function configureDpdb(next: DpdbConfig | undefined): void {
  if (next?.apiBase !== undefined) config.apiBase = next.apiBase;
  if (next?.fileProxy !== undefined) config.fileProxy = next.fileProxy;
}

const PROXIED_HOSTS = new Set(["files.dynamicpdb.com", "dynamicpdb.com"]);

/** Rewrites a published artifact uri into something this browser can actually fetch. */
export function toFetchableUrl(uri: string): string {
  if (!config.fileProxy || !/^https?:\/\//.test(uri)) return uri;
  return PROXIED_HOSTS.has(new URL(uri).host) ? `${config.fileProxy}?u=${encodeURIComponent(uri)}` : uri;
}

// --- response shapes, only the fields we read ---

interface Resource<A> {
  id: string;
  type: string;
  attributes: A;
}
interface EntryAttrs {
  title: string;
  details?: string | null;
  method?: string | null;
  space_group?: string | null;
  resolution?: number | null;
  published_at?: string | null;
  external_refs?: { pdb?: string };
  crystallography?: {
    crystals?: {
      growth?: { ph?: number | null; temperature_kelvin?: number | null } | null;
      diffractions?: { temperature_kelvin?: number | null }[] | null;
    }[] | null;
  } | null;
  polymer_entities?: {
    label_entity_id?: string | null;
    description?: string | null;
    source_organisms?: { scientific_name?: string | null }[] | null;
    uniprot_mappings?: { accession?: string | null; source?: string | null }[] | null;
  }[] | null;
}
interface ModelAttrs {
  title: string;
  metadata?: {
    model_type?: string | null;
    purpose?: string | null;
    external_refs?: { pdb?: string | null } | null;
    member_count?: number | null;
  };
  metrics?: { key: string; value: number }[];
  primary_artifact_id?: string | null;
}
interface ModelDetailAttrs {
  /** per-residue values the catalogue stores for the model; null or empty for most models */
  residue_data?:
    | {
        auth_asym_id?: string | null;
        auth_seq_id?: number | null;
        pdbx_pdb_ins_code?: string | null;
        rscc?: number | null;
        b_iso?: number | null;
        occupancy?: number | null;
      }[]
    | null;
}
interface ArtifactAttrs {
  name: string;
  /** "model" | "structure_factors" | "other" */
  type: string;
  /** "cif" | "pdb" | "structure_factors_cif" | "log" */
  format: string;
  size_bytes: number | null;
  sha256: string | null;
  uri: string;
}
interface ArtifactsResponse {
  data: Resource<ArtifactAttrs>[];
  meta?: { runs?: { software_name?: string | null; software_version?: string | null }[] };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${config.apiBase}/${path}`);
  if (res.status === 429) throw new Error("Dynamic PDB rate limit hit (100 requests per 10 s per IP); wait a moment and retry");
  if (!res.ok) throw new Error(`Dynamic PDB ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Roles come from the catalogue title; model_type is not consistent across entries. */
export function deriveRole(title: string, meta: { model_type?: string | null } = {}): ModelRole {
  const t = title.toLowerCase();
  if (t.includes("deposited")) return "deposited";
  if (t.includes("qfit")) return "qfit";
  if (t.includes("rerefined") || t.includes("re-refined")) return "rerefined";
  if (t.includes("ensemble")) return "ensemble";
  const mt = (meta.model_type ?? "").toLowerCase();
  if (mt === "deposited") return "deposited";
  if (mt === "ensemble") return "ensemble";
  return "other";
}

const METRIC_KEYS: readonly string[] = ["r_work", "r_free", "clashscore", "ramachandran_outliers"];

function pickMetrics(list: ModelAttrs["metrics"]): ManifestModel["metrics"] {
  const out: ManifestModel["metrics"] = {};
  for (const m of list ?? []) if (METRIC_KEYS.includes(m.key)) out[m.key as MetricKey] = m.value;
  return out;
}

function toFormat(f: string): ModelFormat {
  return f === "pdb" ? "pdb" : "cif";
}

/** The stored per-residue values of one model, keyed by author residue; empty when it has none. */
export async function fetchModelResidueData(dpdbId: string, modelId: string): Promise<StoredResidueRow[]> {
  const detail = await apiGet<{ data: Resource<ModelDetailAttrs> }>(`entries/${dpdbId}/models/${modelId}`);
  const rows: StoredResidueRow[] = [];
  for (const row of detail.data.attributes.residue_data ?? []) {
    if (!row.auth_asym_id || row.auth_seq_id == null) continue;
    rows.push({
      ref: { chain: row.auth_asym_id, seq: row.auth_seq_id, ins: row.pdbx_pdb_ins_code ?? "" },
      rscc: row.rscc ?? null,
      bIso: row.b_iso ?? null,
      occupancy: row.occupancy ?? null,
    });
  }
  return rows;
}

/** entry + models + every model's artifacts: any of them can be the one the host asks for */
export async function fetchEntryManifest(dpdbId: string): Promise<EntryManifest> {
  const [entryRes, modelsRes] = await Promise.all([
    apiGet<{ data: Resource<EntryAttrs> }>(`entries/${dpdbId}`),
    apiGet<{ data: Resource<ModelAttrs>[] }>(`entries/${dpdbId}/models`),
  ]);
  const entry = entryRes.data.attributes;
  const pdbId = (entry.external_refs?.pdb ?? "").toUpperCase();
  // the entry response already carries the landing-page facts: no extra requests
  const crystal = entry.crystallography?.crystals?.[0];
  const catalogue: EntryCatalogueInfo = {
    details: entry.details ?? null,
    method: entry.method ?? null,
    spaceGroup: entry.space_group ?? null,
    publishedAt: entry.published_at ?? null,
    growthPh: crystal?.growth?.ph ?? null,
    growthTempK: crystal?.growth?.temperature_kelvin ?? crystal?.diffractions?.[0]?.temperature_kelvin ?? null,
    entities: (entry.polymer_entities ?? []).map((e) => ({
      entityId: e.label_entity_id ?? null,
      description: e.description ?? null,
      organism: e.source_organisms?.[0]?.scientific_name ?? null,
      uniprot: e.uniprot_mappings?.[0]?.accession ?? null,
    })),
  };

  // ids are read off the resources: the entry's attributes carry none
  const summaries = modelsRes.data.map((m) => ({ ...m.attributes, id: m.id, role: deriveRole(m.attributes.title, m.attributes.metadata) }));
  const lists = await Promise.all(summaries.map((m) => apiGet<ArtifactsResponse>(`entries/${dpdbId}/models/${m.id}/artifacts`)));
  const artifactsByModel = new Map(summaries.map((m, i) => [m.id, lists[i]]));

  let sf: EntryManifest["sf"] | null = null;
  const models: ManifestModel[] = [];
  for (const m of summaries) {
    const model: ManifestModel = {
      id: m.id,
      role: m.role,
      title: m.title,
      format: null,
      url: null,
      sizeBytes: null,
      sha256: null,
      software: null,
      metrics: pickMetrics(m.metrics),
      modelType: m.metadata?.model_type ?? null,
      purpose: m.metadata?.purpose ?? null,
      pdbRef: m.metadata?.external_refs?.pdb?.toUpperCase() ?? null,
      memberCount: m.metadata?.member_count ?? null,
    };
    const arts = artifactsByModel.get(m.id);
    if (arts) {
      const coords =
        arts.data.find((x) => x.attributes.type === "model" && x.id === m.primary_artifact_id) ??
        arts.data.find((x) => x.attributes.type === "model");
      if (coords) {
        const c = coords.attributes;
        model.format = toFormat(c.format);
        model.url = c.uri;
        model.sizeBytes = c.size_bytes;
        model.sha256 = c.sha256;
      }
      // the deposited model's run record is ETL filler ("_software.os"); only qFit's is real
      if (m.role === "qfit") {
        const runs = (arts.meta?.runs ?? [])
          .map((r) => [r.software_name, r.software_version].filter(Boolean).join(" "))
          .filter(Boolean);
        model.software = runs.length ? runs.join(", ") : null;
      }
      const sfArt = arts.data.find((x) => x.attributes.type === "structure_factors");
      if (sfArt && !sf) {
        sf = {
          url: sfArt.attributes.uri,
          sizeBytes: sfArt.attributes.size_bytes,
          note: `deposited structure factors (Dynamic PDB artifact ${sfArt.attributes.name})`,
        };
      }
    }
    models.push(model);
  }

  return {
    id: entryRes.data.id,
    pdbId,
    title: entry.title,
    resolution: entry.resolution ?? null,
    source: "dpdb",
    catalogue,
    models,
    sf: sf ?? {
      url: `https://files.rcsb.org/download/${pdbId}-sf.cif`,
      sizeBytes: null,
      note: "deposited structure factors, fetched from RCSB (not listed in the catalogue)",
    },
  };
}
