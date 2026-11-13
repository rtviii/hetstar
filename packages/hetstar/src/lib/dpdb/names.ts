import { ROLE_LABELS, type ManifestModel } from "./types";

// What a model is called wherever the viewer lists the models of an entry. The catalogue
// title is the depositor's own name for it and comes first; everything the catalogue knows
// beyond the title goes into the detail lines.

const METRIC_LABELS: Record<string, string> = {
  r_work: "R-work",
  r_free: "R-free",
  clashscore: "clashscore",
  ramachandran_outliers: "Ramachandran outliers",
};

/** the trailing number of a catalogue model id (dpdb_xxxxxxxx_m_003 -> 3) */
function modelOrdinal(id: string): number | null {
  const match = /_m_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * The model's name among its siblings: the catalogue title, with its own PDB id and member
 * count when it has them, and its catalogue number when another model carries the same title.
 */
export function modelDisplayName(model: ManifestModel, siblings: readonly ManifestModel[] = []): string {
  const parts = [model.title];
  if (model.pdbRef) parts.push(model.pdbRef);
  if (model.memberCount && model.memberCount > 1) parts.push(`${model.memberCount} members`);
  const sameTitle = siblings.some((other) => other.id !== model.id && other.title === model.title);
  const ordinal = sameTitle ? modelOrdinal(model.id) : null;
  if (ordinal !== null) parts.push(`no. ${ordinal}`);
  return parts.join(" · ");
}

/** everything else the catalogue records about the model, one fact per line */
export function modelDetailLines(model: ManifestModel): string[] {
  const lines: string[] = [];
  const kind = [model.modelType, model.purpose].filter(Boolean).join(", ");
  lines.push(kind ? `${ROLE_LABELS[model.role]} (${kind})` : ROLE_LABELS[model.role]);
  if (model.software) lines.push(model.software);
  const metrics = Object.entries(model.metrics)
    .map(([key, value]) => `${METRIC_LABELS[key] ?? key} ${value}`)
    .join(", ");
  if (metrics) lines.push(metrics);
  if (model.format) {
    const size = model.sizeBytes != null ? `, ${(model.sizeBytes / 1e6).toFixed(2)} MB` : "";
    lines.push(`${model.format === "pdb" ? "PDB format, converted to mmCIF on load" : "mmCIF"}${size}`);
  } else {
    lines.push("no coordinate file listed");
  }
  lines.push(model.id);
  return lines;
}
