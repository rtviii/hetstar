import { DEFAULT_REP_STYLE, type RepStyle } from "@/lib/molstar/repstyle";
import { normalizeSelection, EMPTY_SELECTION, type LabSelection } from "./selection";

// Selection bookmarks: a snapshot of the selection plus the RepStyle active when it was
// saved (deliberately NOT conformer expansions / clip / globalAlt — only the state that
// drives the Mol* representations). Persisted per entry in localStorage under a versioned
// envelope; anything malformed degrades to an empty list, never throws.

export interface SelectionBookmark {
  id: string;
  createdAt: number;
  selection: LabSelection;
  repStyle: RepStyle;
}

export const MAX_BOOKMARKS = 9;

const storageKey = (entryId: string) => `hetstar.lab.bookmarks.${entryId}`;

/** Merge over DEFAULT_REP_STYLE, nested groups individually, so schema drift can't feed undefined size factors into applyRepStyle. */
export function sanitizeRepStyle(s: unknown): RepStyle {
  const d = DEFAULT_REP_STYLE;
  if (typeof s !== "object" || s === null) return { ...d };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = s as any;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    type: oneOf(r.type, ["ball-and-stick", "spacefill", "cartoon"] as const, d.type),
    colorMode: oneOf(r.colorMode, ["model", "element", "chain"] as const, d.colorMode),
    quality: oneOf(r.quality, ["auto", "high", "medium", "low"] as const, d.quality),
    ballStick: { sizeFactor: num(r.ballStick?.sizeFactor, d.ballStick.sizeFactor) },
    spacefill: { sizeFactor: num(r.spacefill?.sizeFactor, d.spacefill.sizeFactor) },
    cartoon: { sizeFactor: num(r.cartoon?.sizeFactor, d.cartoon.sizeFactor) },
  };
}

function sanitizeSelection(s: unknown): LabSelection {
  if (typeof s !== "object" || s === null) return EMPTY_SELECTION;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = s as any;
  const ranges = Array.isArray(r.ranges)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.ranges.filter((x: any) => x && typeof x.chain === "string" && typeof x.from === "number" && typeof x.to === "number")
    : [];
  const atoms = Array.isArray(r.atoms)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      r.atoms.filter((x: any) => x && typeof x.chain === "string" && typeof x.seq === "number" && typeof x.atom === "string")
    : [];
  return normalizeSelection({ ranges, atoms });
}

export function loadBookmarks(entryId: string): SelectionBookmark[] {
  try {
    const raw = localStorage.getItem(storageKey(entryId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.items)) return [];
    return (
      parsed.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b && typeof b.id === "string")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => ({
          id: b.id,
          createdAt: typeof b.createdAt === "number" ? b.createdAt : 0,
          selection: sanitizeSelection(b.selection),
          repStyle: sanitizeRepStyle(b.repStyle),
        }))
        .slice(0, MAX_BOOKMARKS)
    );
  } catch {
    return [];
  }
}

export function saveBookmarks(entryId: string, items: SelectionBookmark[]): void {
  try {
    localStorage.setItem(storageKey(entryId), JSON.stringify({ v: 1, items }));
  } catch {
    // storage unavailable (private mode, quota) — bookmarks stay session-only
  }
}
