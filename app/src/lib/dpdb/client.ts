// Thin client for the Dynamic PDB catalogue (JSON:API at dynamicpdb.com/api/v1).
// In dev the browser cannot call dynamicpdb.com or files.dynamicpdb.com directly (neither
// sends CORS headers for our origin), so both bases default to the same-origin proxy routes
// under /api. When hetstar is embedded on dynamicpdb.com set NEXT_PUBLIC_DPDB_API_BASE=/api/v1
// and, once the files host allows that origin, NEXT_PUBLIC_DPDB_FILE_PROXY= (empty) so S3
// artifacts are fetched directly.

import type { EntryManifest, ManifestModel, MetricKey, ModelFormat, ModelRole } from "./types";

export const DPDB_API_BASE = process.env.NEXT_PUBLIC_DPDB_API_BASE ?? "/api/dpdb";
export const DPDB_FILE_PROXY = process.env.NEXT_PUBLIC_DPDB_FILE_PROXY ?? "/api/dpdb-file";

const PROXIED_HOSTS = new Set(["files.dynamicpdb.com", "dynamicpdb.com"]);

/** Rewrites a published artifact uri into something this browser can actually fetch. */
export function toFetchableUrl(uri: string): string {
  if (!DPDB_FILE_PROXY || !/^https?:\/\//.test(uri)) return uri;
  return PROXIED_HOSTS.has(new URL(uri).host) ? `${DPDB_FILE_PROXY}?u=${encodeURIComponent(uri)}` : uri;
}

// --- response shapes, only the fields we read ---

interface Resource<A> {
  id: string;
  type: string;
  attributes: A;
}
interface EntryAttrs {
  id: string;
  title: string;
  resolution?: number | null;
  external_refs?: { pdb?: string };
}
interface ModelAttrs {
  id: string;
  title: string;
  metadata?: { model_type?: string; purpose?: string };
  metrics?: { key: string; value: number }[];
  primary_artifact_id?: string | null;
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
  const res = await fetch(`${DPDB_API_BASE}/${path}`);
  if (res.status === 429) throw new Error("Dynamic PDB rate limit hit (100 requests/min); wait a minute and retry");
  if (!res.ok) throw new Error(`Dynamic PDB ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Roles come from the catalogue title; model_type is not consistent across entries. */
export function deriveRole(title: string, meta: { model_type?: string } = {}): ModelRole {
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

/**
 * entry + models + artifacts for the models this pass loads (deposited, qFit): four requests.
 * Other roles are listed with null url/format so the UI can say they exist.
 */
export async function fetchEntryManifest(dpdbId: string): Promise<EntryManifest> {
  const [entryRes, modelsRes] = await Promise.all([
    apiGet<{ data: Resource<EntryAttrs> }>(`entries/${dpdbId}`),
    apiGet<{ data: Resource<ModelAttrs>[] }>(`entries/${dpdbId}/models`),
  ]);
  const entry = entryRes.data.attributes;
  const pdbId = (entry.external_refs?.pdb ?? "").toUpperCase();

  const summaries = modelsRes.data.map((m) => ({ ...m.attributes, role: deriveRole(m.attributes.title, m.attributes.metadata) }));
  const wanted = summaries.filter((m) => m.role === "deposited" || m.role === "qfit");
  const lists = await Promise.all(wanted.map((m) => apiGet<ArtifactsResponse>(`entries/${dpdbId}/models/${m.id}/artifacts`)));
  const artifactsByModel = new Map(wanted.map((m, i) => [m.id, lists[i]]));

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
    id: entry.id,
    pdbId,
    title: entry.title,
    resolution: entry.resolution ?? null,
    source: "dpdb",
    models,
    sf: sf ?? {
      url: `https://files.rcsb.org/download/${pdbId}-sf.cif`,
      sizeBytes: null,
      note: "deposited structure factors, fetched from RCSB (not listed in the catalogue)",
    },
  };
}
