import type { LoadableModel, ManifestModel } from "../../lib/dpdb/types";
import type { RepKind } from "../../lib/molstar/repstyle";
import { GHOST_B_COLOR, MODEL_A_COLOR } from "../../lib/molstar/style";
import { SOURCE_GHOST, type Appearance, type ColorSourceId } from "../board/board";

// What the viewer holds about each model of the loaded entry besides its file: whether its
// replica is on in the switchboard, whether it is drawn in the main view, and how it looks.
// A model has ONE look, the same in the main view and in its replica. One record per model,
// kept by the host, read by the switchboard and the style board alike.

export interface ModelCard {
  /** its replica canvas is on in the switchboard */
  replica: boolean;
  /** it is drawn in the main view (as the main model, or behind it) */
  sceneVisible: boolean;
  /** how it looks, wherever it is drawn */
  look: Appearance;
}

export type ModelCards = Readonly<Record<string, ModelCard>>;

export interface SwitchboardOptions {
  /** whether the dock starts open; default true */
  defaultOpen?: boolean;
  /** the replicas a fresh entry opens with: every model up to maxBoxes (default), or the
   * main view's model alone */
  boxes?: "primary" | "all";
  /** most replicas at once; each one is a WebGL context of its own */
  maxBoxes?: number;
}

const DEFAULT_MAX_BOXES = 4;
/** browsers cap live WebGL contexts (16 in Chrome, fewer elsewhere); the main view has one */
const HARD_MAX_BOXES = 6;
/** a model file above this is fetched only when its model is asked for */
export const PRELOAD_MAX_BYTES = 5e6;
/** the mean trace-atom distance to the main view's model above which a model is off-frame, in angstrom */
export const OFF_FRAME_ANGSTROM = 1;
/** identity colours of the models beside the default main one and the deposited one */
const EXTRA_MODEL_COLORS = [0x9fb7a5, 0xc4a5b8, 0xa9b3cf, 0xd0b99a];

export function maxReplicas(options: SwitchboardOptions | undefined): number {
  return Math.max(1, Math.min(HARD_MAX_BOXES, options?.maxBoxes ?? DEFAULT_MAX_BOXES));
}

export function isLoadable(model: ManifestModel): model is LoadableModel {
  return !!model.url && !!model.format;
}

/** small enough to fetch and parse without being asked (an unknown size counts as small) */
export function isSmallFile(model: ManifestModel): boolean {
  return model.sizeBytes == null || model.sizeBytes <= PRELOAD_MAX_BYTES;
}

/**
 * The colour each model of the entry is known by, in the main view, the switchboard and the
 * style board. It does not follow the main view: `defaultMainId` (the model the entry opens
 * on) keeps the warm colour and the deposited model the cool one, whichever is active.
 */
export function modelIdentityColors(models: readonly ManifestModel[], defaultMainId: string | null): Map<string, number> {
  const out = new Map<string, number>();
  let extra = 0;
  for (const model of models) {
    if (model.id === defaultMainId) out.set(model.id, MODEL_A_COLOR);
    else if (model.role === "deposited") out.set(model.id, GHOST_B_COLOR);
    else out.set(model.id, EXTRA_MODEL_COLORS[extra++ % EXTRA_MODEL_COLORS.length]);
  }
  return out;
}

/**
 * The cards a fresh entry opens with. The main model takes the preset's look; the deposited
 * model stands behind it as a ghost; every other model is a ghost that is not drawn yet.
 * Replicas start on for the main model and, unless the host asked for it alone, for the
 * other models whose files are small, up to the cap.
 */
export function initialModelCards(
  models: readonly ManifestModel[],
  mainId: string,
  look: { rep: RepKind; color: ColorSourceId },
  options: SwitchboardOptions | undefined,
): ModelCards {
  const cap = maxReplicas(options);
  const cards: Record<string, ModelCard> = {};
  let replicas = 1;
  for (const model of models) {
    const isMain = model.id === mainId;
    let replica = isMain;
    if (!isMain && options?.boxes !== "primary" && isLoadable(model) && isSmallFile(model) && replicas < cap) {
      replica = true;
      replicas++;
    }
    cards[model.id] = {
      replica,
      sceneVisible: isMain || (model.role === "deposited" && isLoadable(model)),
      look: { color: isMain ? look.color : SOURCE_GHOST, rep: look.rep, het: true, ions: true },
    };
  }
  return cards;
}

export function withCard(cards: ModelCards, modelId: string, change: (card: ModelCard) => ModelCard): ModelCards {
  const card = cards[modelId];
  return card ? { ...cards, [modelId]: change(card) } : cards;
}

/**
 * The cards after the main view moved from one model to another. Every model keeps its own
 * look, with one exception: a model that was a ghost cannot be the main view as one, so it
 * takes the look of the model it replaces, which becomes the ghost.
 */
export function withMainMoved(cards: ModelCards, fromId: string, toId: string): ModelCards {
  const from = cards[fromId];
  const to = cards[toId];
  if (!from || !to) return cards;
  if (to.look.color !== SOURCE_GHOST) return { ...cards, [toId]: { ...to, sceneVisible: true } };
  return {
    ...cards,
    [fromId]: { ...from, look: { ...from.look, color: SOURCE_GHOST } },
    [toId]: { ...to, sceneVisible: true, look: { ...to.look, color: from.look.color } },
  };
}
