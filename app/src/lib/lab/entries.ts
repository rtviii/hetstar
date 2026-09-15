// The entries the compare lab ships with: the two whose qFit multiconformer models are
// bundled into the app (app/public/corpus/). These rows are the offline fallback; anything
// else is resolved live from the Dynamic PDB catalogue (lib/dpdb/), and both paths produce
// the same EntryManifest (lib/dpdb/types.ts) via lib/dpdb/resolve.ts.

export interface EntrySource {
  url: string;
  /** provenance prose: what the file IS and how it was obtained (shown in "sources") */
  note: string;
}

export interface EntryDef {
  id: string;
  label: string;
  /** model A: qFit multiconformer CIF (local copy of the corpus/fixture file) */
  qfit?: EntrySource;
  /** model B — or the ONLY model (an NMR/ensemble mmCIF, a local corpus drop) when qfit is absent */
  deposited?: EntrySource;
  /** structure factors (map coefficients) for the client-side FFT; absent = no density lab */
  sf?: EntrySource & { approxMB: number };
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
  {
    // multi-MODEL exercise entry: ubiquitin NMR bundle, 10 members, no structure factors.
    // A local ensemble-refinement file works the same way: drop it in app/public/corpus
    // and add a row with deposited.url "/corpus/<file>.cif".
    id: "1D3Z",
    label: "1D3Z (NMR ensemble)",
    deposited: {
      url: "https://files.rcsb.org/download/1D3Z.cif",
      note: "deposited NMR ensemble (ubiquitin, 10 MODEL frames), fetched from RCSB at load time",
    },
  },
  // Meatier ensemble entries (model counts verified against the RCSB data API 2026-09):
  {
    id: "1E8L",
    label: "1E8L (lysozyme, 50 models)",
    deposited: {
      url: "https://files.rcsb.org/download/1E8L.cif",
      note: "deposited NMR ensemble (hen lysozyme, 129 residues, 50 MODEL frames), fetched from RCSB at load time",
    },
  },
  {
    id: "2K39",
    label: "2K39 (ubiquitin RDC, 116 models)",
    deposited: {
      url: "https://files.rcsb.org/download/2K39.cif",
      note: "RDC-derived ubiquitin ensemble (EROS; motions up to microseconds), 116 MODEL frames, fetched from RCSB at load time",
    },
  },
  {
    id: "1XQQ",
    label: "1XQQ (ubiquitin DER, 128 models)",
    deposited: {
      url: "https://files.rcsb.org/download/1XQQ.cif",
      note: "dynamic-ensemble-refinement ubiquitin (structure + dynamics simultaneously), 128 MODEL frames, fetched from RCSB at load time",
    },
  },
  {
    id: "2KOX",
    label: "2KOX (ubiquitin, 640 models — stress test)",
    deposited: {
      url: "https://files.rcsb.org/download/2KOX.cif",
      note: "RDC ensemble probing correlated backbone motions, 640 MODEL frames — the heavy scrubber/RMSF stress case, fetched from RCSB at load time",
    },
  },
];

export function findEntry(id: string): EntryDef | null {
  const norm = id.trim().toUpperCase();
  return ENTRIES.find((e) => e.id === norm) ?? null;
}

/** water component ids, excluded from residue aggregates and ligand listings */
export const WATER_COMPS = new Set(["HOH", "DOD", "WAT"]);

// Loader pipeline stages, in order. Each renders as a status dot in the loader panel.
export const STAGES = ["catalogue", "models", "tables", "sf-fetch", "fft", "carve", "iso"] as const;
export type StageId = (typeof STAGES)[number];
export type StageState = "pending" | "active" | "done" | "error";

export const STAGE_LABELS: Record<StageId, string> = {
  catalogue: "catalogue lookup",
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
