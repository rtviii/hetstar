"use client";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelBundle } from "../lib/lab/model-bundle";
import { applyModelLook, applyModelVisibility, type ModelLook } from "../lib/molstar/appearance";
import type { ConformerPlan } from "../lib/molstar/conformers";
import { removeNode, type ClipObjectSpec } from "../lib/molstar/density";
import type { RepStyle } from "../lib/molstar/repstyle";
import { SECONDARY_TRANSPARENCY } from "../lib/molstar/style";
import type { MolstarViewer } from "../lib/molstar/viewer";

// The models that stand in the main scene beside the main view's own: any number of them,
// each built the first time it is to be drawn, each with a look and a visibility of its own.
// A model stays in the tree once built (hiding it costs nothing, building it again would),
// until the scene is reset for another entry. Every write to the Mol* tree goes through the
// host's styling serializer, in the order load, look, visibility, so a model is revealed
// only once it is styled.

export interface SceneModelSpec {
  id: string;
  /** drawn now: its eye is on and it is not the main view's model */
  shown: boolean;
  /** null until its file is in */
  bundle: ModelBundle | null;
  label: string;
  /** the model's identity colour */
  color: number;
  look: ModelLook;
  plan: ConformerPlan;
}

export interface SceneModels {
  /** the structure refs of the models built so far, by model id */
  refs: ReadonlyMap<string, string>;
  /** bumps after a look was applied: whatever a restyle wipes (the clip) is put back then */
  styled: number;
  /** every model that is to be drawn has been built, or has failed */
  settled: boolean;
  /** forget everything: the tree is about to be cleared */
  reset(): void;
}

interface Applied {
  structureRef: string;
  look: ModelLook;
  color: number;
  base: RepStyle;
  plan: ConformerPlan;
  shown: boolean;
}

function samePaint(a: ModelLook["paint"], b: ModelLook["paint"]): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "color" && b.kind === "color") return a.mode === b.mode && a.ramp === b.ramp;
  if (a.kind === "track" && b.kind === "track") return a.paint === b.paint;
  return true;
}

function sameLook(previous: Applied, spec: SceneModelSpec, structureRef: string, base: RepStyle): boolean {
  return (
    previous.structureRef === structureRef &&
    previous.color === spec.color &&
    previous.base === base &&
    previous.plan === spec.plan &&
    previous.look.rep === spec.look.rep &&
    previous.look.het === spec.look.het &&
    previous.look.ions === spec.look.ions &&
    samePaint(previous.look.paint, spec.look.paint)
  );
}

export function useSceneModels(args: {
  viewer: MolstarViewer | null;
  /** the main view's own model is in: the tree is this entry's */
  ready: boolean;
  /** a model may be built now (not while the maps are, whose writes a load must not overlap) */
  canLoad: boolean;
  specs: readonly SceneModelSpec[];
  /** the knobs every model shares (mesh quality, representation sizes) */
  base: RepStyle;
  /** the model clip in force, read when a look is applied */
  clipRef: RefObject<ClipObjectSpec[]>;
  runStyling: (key: string, task: () => Promise<void>) => void;
  onError: (message: string) => void;
}): SceneModels {
  const { viewer, ready, canLoad, specs, base, clipRef, runStyling, onError } = args;
  const [refs, setRefs] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [styled, setStyled] = useState(0);
  const [failures, setFailures] = useState<ReadonlySet<string>>(() => new Set());
  const generation = useRef(0);
  const loading = useRef(new Set<string>());
  const applied = useRef(new Map<string, Applied>());

  const reset = useCallback(() => {
    generation.current += 1;
    loading.current.clear();
    applied.current.clear();
    setRefs(new Map());
    setFailures(new Set());
  }, []);

  useEffect(() => {
    const ctx = viewer?.ctx;
    if (!ctx || !viewer || !ready) return;
    for (const spec of specs) {
      const structureRef = refs.get(spec.id);
      if (!structureRef) {
        const bundle = spec.bundle;
        if (!canLoad || !spec.shown || !bundle || loading.current.has(spec.id) || failures.has(spec.id)) continue;
        const token = generation.current;
        loading.current.add(spec.id);
        runStyling(`ghost-load:${spec.id}`, async () => {
          try {
            if (token !== generation.current) return;
            const loaded = await viewer.loadSecondary(bundle.text, { label: spec.label, color: spec.color, split: bundle.split });
            if (!loaded) return;
            if (token !== generation.current) {
              // the scene was reset meanwhile: this model belongs to the entry before
              await removeNode(ctx, loaded.dataRef).catch(() => undefined);
              return;
            }
            setRefs((previous) => new Map(previous).set(spec.id, loaded.structureRef));
          } catch (e) {
            if (token !== generation.current) return;
            setFailures((previous) => new Set(previous).add(spec.id));
            onError(`${spec.label} failed to load into the main view: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            if (token === generation.current) loading.current.delete(spec.id);
          }
        });
        continue;
      }
      const previous = applied.current.get(spec.id);
      const restyle = !previous || !sameLook(previous, spec, structureRef, base);
      if (!restyle && previous.shown === spec.shown) continue;
      applied.current.set(spec.id, { structureRef, look: spec.look, color: spec.color, base, plan: spec.plan, shown: spec.shown });
      if (restyle) {
        runStyling(`look:${spec.id}`, async () => {
          await applyModelLook(ctx, structureRef, spec.look, {
            base,
            uniformColor: spec.color,
            polymerComps: spec.bundle?.split.polymer ?? [],
            plan: spec.plan,
            ghostTransparency: SECONDARY_TRANSPARENCY,
            flatGhost: true,
            pickable: false,
            clip: clipRef.current ?? [],
          });
          setStyled((count) => count + 1);
        });
      }
      // after the look: a restyle makes components, and they are born visible
      runStyling(`vis:${spec.id}`, async () =>
        applyModelVisibility(ctx, structureRef, { visible: spec.shown, het: spec.look.het, ions: spec.look.ions }),
      );
    }
  }, [viewer, ready, canLoad, specs, refs, failures, base, clipRef, runStyling, onError]);

  const settled = specs.every((spec) => !spec.shown || !spec.bundle || refs.has(spec.id) || failures.has(spec.id));

  return useMemo(() => ({ refs, styled, settled, reset }), [refs, styled, settled, reset]);
}
