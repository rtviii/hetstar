// The entries the compare lab ships with: the two whose qFit multiconformer models are
// bundled into the app (app/public/corpus/). The deposited model and structure factors
// for anything the PDB holds are downloadable at runtime (files.rcsb.org sends open CORS
// headers), so growing this registry is one more row.

export interface EntrySource {
  url: string;
  /** provenance prose: what the file IS and how it was obtained (shown in "sources") */
  note: string;
}

export interface EntryDef {
  id: string;
  label: string;
  /** model A: qFit multiconformer CIF (local copy of the corpus/fixture file) */
  qfit: EntrySource;
  /** model B: deposited mmCIF (local fixture copy or RCSB download) */
  deposited: EntrySource;
  /** structure factors (map coefficients) for the client-side FFT */
  sf: EntrySource & { approxMB: number };
}

export const ENTRIES: readonly EntryDef[] = [
  {
    id: "7A1X",
    label: "7A1X",
    qfit: {
      url: "/corpus/7a1x_qFit_010.cif",
      note: "qFit multiconformer model (Wankowicz lab; lineage: PDB-Redo + phenix re-refinement, then qFit), bundled copy from the DYNAMIC_PDB corpus",
    },
    deposited: {
      url: "/corpus/7A1X.cif",
      note: "deposited model, bundled copy — identical to https://files.rcsb.org/download/7A1X.cif",
    },
    sf: {
      url: "https://files.rcsb.org/download/7A1X-sf.cif",
      note: "deposited structure factors, fetched from RCSB",
      approxMB: 5.6,
    },
  },
  {
    id: "9JD2",
    label: "9JD2",
    qfit: {
      url: "/corpus/9jd2_qFit_010.cif",
      note: "qFit multiconformer model (Wankowicz lab; lineage: PDB-Redo + phenix re-refinement, then qFit), bundled copy from the DYNAMIC_PDB corpus",
    },
    deposited: {
      url: "https://files.rcsb.org/download/9JD2.cif",
      note: "deposited mmCIF, fetched from RCSB at load time",
    },
    sf: {
      url: "https://files.rcsb.org/download/9JD2-sf.cif",
      note: "deposited structure factors, fetched from RCSB",
      approxMB: 3,
    },
  },
];

export function findEntry(id: string): EntryDef | null {
  const norm = id.trim().toUpperCase();
  return ENTRIES.find((e) => e.id === norm) ?? null;
}

// Loader pipeline stages, in order. Each renders as a status dot in the loader panel.
export const STAGES = ["models", "tables", "sf-fetch", "fft", "carve", "iso"] as const;
export type StageId = (typeof STAGES)[number];
export type StageState = "pending" | "active" | "done" | "error";

export const STAGE_LABELS: Record<StageId, string> = {
  models: "model files",
  tables: "atom tables",
  "sf-fetch": "structure factors",
  fft: "FFT to maps",
  carve: "carve to model",
  iso: "isosurfaces",
};

export interface ProvenanceRecord {
  role: "model A" | "model B" | "structure factors" | "maps";
  /** prose: what the file is and where it came from */
  desc: string;
  /** the concrete URL (rendered as a link) or app-served path (rendered as mono text) */
  url?: string;
}
