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

const ROLE_SHORT: Record<ManifestModel["role"], string> = {
  deposited: "depos",
  qfit: "qFit",
  rerefined: "reref",
  ensemble: "ensem",
  other: "model",
};

/** the model in a few letters, for a narrow column head: its role, numbered when another
 * model of the entry has the same role */
export function modelShortName(model: ManifestModel, siblings: readonly ManifestModel[] = []): string {
  const sameRole = siblings.filter((other) => other.role === model.role);
  const short = ROLE_SHORT[model.role];
  return sameRole.length > 1 ? `${short} ${sameRole.findIndex((other) => other.id === model.id) + 1}` : short;
}

/** everything else the catalogue records about the model, as labelled facts */
export function modelDetailRows(model: ManifestModel): { label: string; text: string }[] {
  const rows: { label: string; text: string }[] = [];
  const kind = [model.modelType, model.purpose].filter(Boolean).join(", ");
  rows.push({ label: "kind", text: kind ? `${ROLE_LABELS[model.role]} (${kind})` : ROLE_LABELS[model.role] });
  if (model.software) rows.push({ label: "software", text: model.software });
  for (const [key, value] of Object.entries(model.metrics)) rows.push({ label: METRIC_LABELS[key] ?? key, text: String(value) });
  rows.push({ label: "file", text: modelFileLine(model) });
  rows.push({ label: "id", text: model.id });
  return rows;
}

/** the model's coordinate file in a phrase */
export function modelFileLine(model: ManifestModel): string {
  if (!model.format) return "no coordinate file listed";
  const size = model.sizeBytes != null ? `, ${(model.sizeBytes / 1e6).toFixed(2)} MB` : "";
  return `${model.format === "pdb" ? "PDB format, converted to mmCIF on load" : "mmCIF"}${size}`;
}
