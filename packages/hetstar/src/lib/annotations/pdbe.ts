import { residueKey, type ChainSequence, type SequenceModel } from "@dynamic-pdb/hetkit/model";

// PDBe annotations for one PDB entry, fetched directly from www.ebi.ac.uk (the API sends
// access-control-allow-origin: *, so no proxy): SIFTS domain mappings (Pfam, CATH, SCOP,
// InterPro) plus modified residues. The host fetches ONCE per entry and converts to lane
// coordinates through the SequenceModel; lanes only draw. PDBe keys responses by the
// lowercase pdb id, chains by BOTH struct_asym_id (label) and chain_id (auth), and
// residues by residue_number (label_seq) alongside the author number — the same join
// problem readSecondaryStructure solves, handled the same way here.
// (PDBe's binding_sites endpoints are retired — 404 for every entry, REST and graph-api
// alike, checked 2026-09-11 — so binding-site membership is computed locally instead:
// lanes/ContactLane.tsx.)

const PDBE_API = "https://www.ebi.ac.uk/pdbe/api";

/** one drawn block, in lane positions (1-based, inclusive) */
export interface AnnotationSpan {
  start: number;
  end: number;
  /** what the block IS ("Ras family", "binding site for GDP") */
  label: string;
  /** accession / site id, shown with the label in titles */
  id: string;
  color: string;
}

/** source id -> auth chain -> spans (sorted by start) */
export type AnnotationsBySource = Map<string, Map<string, AnnotationSpan[]>>;

export interface PdbeRaw {
  pdbId: string;
  mappings: unknown;
  modified: unknown;
}

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null; // PDBe answers 404 when an entry has no such data
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** two parallel GETs, each independently failable; never rejects */
export async function fetchPdbeAnnotations(pdbId: string): Promise<PdbeRaw> {
  const id = pdbId.toLowerCase();
  const [mappings, modified] = await Promise.all([
    getJson(`${PDBE_API}/mappings/${id}`),
    getJson(`${PDBE_API}/pdb/entry/modified_AA_or_NA/${id}`),
  ]);
  return { pdbId: id, mappings, modified };
}

// --- conversion to lane coordinates ---

// stable, muted block palette; indexed by accession hash so a domain keeps its color
// across chains and entries
const PALETTE = ["#5b8bd9", "#d9885b", "#7bb069", "#b06fc0", "#bfa348", "#52b3ae", "#c05f74", "#8a8f5b"];
function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface ResiduePoint {
  residue_number?: number | null;
  author_residue_number?: number | null;
  author_insertion_code?: string | null;
  chain_id?: string | null;
  struct_asym_id?: string | null;
  chem_comp_id?: string | null;
}
interface MappingSegment extends ResiduePoint {
  start?: ResiduePoint;
  end?: ResiduePoint;
}
interface MappingFamily {
  identifier?: string;
  name?: string;
  description?: string;
  mappings?: MappingSegment[];
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** auth chain of a PDBe residue/segment: label join first, auth id as the fallback */
function chainOf(model: SequenceModel, p: ResiduePoint): ChainSequence | null {
  const viaLabel = p.struct_asym_id ? model.authOfLabelAsym.get(p.struct_asym_id) : undefined;
  const chain = viaLabel ?? p.chain_id ?? null;
  return chain ? (model.byChain.get(chain) ?? null) : null;
}

/** lane position of a PDBe residue point on a chain, or null when it cannot be placed */
function posOf(chain: ChainSequence, p: ResiduePoint | undefined): number | null {
  if (!p) return null;
  const label = p.residue_number;
  if (chain.positionsAreLabelSeq && typeof label === "number" && Number.isFinite(label)) {
    return Math.min(chain.length, Math.max(1, label));
  }
  const auth = p.author_residue_number;
  if (typeof auth !== "number" || !Number.isFinite(auth)) return null;
  return chain.posByKey.get(residueKey({ chain: chain.chain, seq: auth, ins: p.author_insertion_code ?? "" })) ?? null;
}

function push(out: AnnotationsBySource, source: string, chain: string, span: AnnotationSpan) {
  let byChain = out.get(source);
  if (!byChain) out.set(source, (byChain = new Map()));
  const list = byChain.get(chain);
  if (list) list.push(span);
  else byChain.set(chain, [span]);
}

// SIFTS section name in the mappings response -> our lane source id
const SIFTS_SECTIONS: Record<string, string> = {
  Pfam: "pfam",
  CATH: "cath",
  SCOP: "scop",
  InterPro: "interpro",
};

export function mapAnnotations(raw: PdbeRaw, model: SequenceModel): AnnotationsBySource {
  const out: AnnotationsBySource = new Map();

  const mappingsRoot = asRecord(asRecord(raw.mappings)?.[raw.pdbId]);
  if (mappingsRoot) {
    for (const [section, sourceId] of Object.entries(SIFTS_SECTIONS)) {
      const families = asRecord(mappingsRoot[section]);
      if (!families) continue;
      for (const [accession, famRaw] of Object.entries(families)) {
        const fam = famRaw as MappingFamily;
        const label = fam.description ?? fam.name ?? fam.identifier ?? accession;
        const color = colorFor(accession);
        for (const seg of fam.mappings ?? []) {
          const chain = chainOf(model, seg);
          if (!chain) continue;
          const start = posOf(chain, seg.start);
          const end = posOf(chain, seg.end);
          if (start === null || end === null) continue;
          push(out, sourceId, chain.chain, {
            start: Math.min(start, end),
            end: Math.max(start, end),
            label,
            id: accession,
            color,
          });
        }
      }
    }
  }

  const mods = asRecord(raw.modified)?.[raw.pdbId];
  if (Array.isArray(mods)) {
    for (const modRaw of mods) {
      const res = modRaw as ResiduePoint;
      const chain = chainOf(model, res);
      if (!chain) continue;
      const pos = posOf(chain, res);
      if (pos === null) continue;
      const comp = res.chem_comp_id ?? "modified";
      push(out, "modified", chain.chain, { start: pos, end: pos, label: `modified residue ${comp}`, id: comp, color: colorFor(comp) });
    }
  }

  for (const byChain of out.values()) {
    for (const list of byChain.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return out;
}
