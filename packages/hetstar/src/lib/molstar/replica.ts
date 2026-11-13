import type { Camera } from "molstar/lib/mol-canvas3d/camera";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { type Structure, StructureElement } from "molstar/lib/mol-model/structure";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import {
  clearStructureTransparency,
  setStructureTransparency,
} from "molstar/lib/mol-plugin-state/helpers/structure-transparency";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { Color } from "molstar/lib/mol-util/color";
import type { LabSelection } from "../lab/selection";
import { EMPTY_SELECTION } from "../lab/selection";
import type { FitSphere } from "./camera-sync";
import {
  applyConformerStyling,
  componentsForStructure,
  isOverlayComponent,
  planConformers,
  type ResidueRange,
} from "./conformers";
import type { ConformerRamp } from "./ghost-theme";
import { ensureLookingGlass, type LookingGlass, type LookingGlassRefs } from "./looking-glass";
import { executeQuery, residueLoci, selectionExpression, structureToLoci } from "./queries";
import {
  applyRepStyle,
  DEFAULT_REP_STYLE,
  ensureLabComponents,
  type CompSplit,
  type RepColorMode,
  type RepStyle,
} from "./repstyle";
import { syncSelRepOverlays, type SelRepOverlay } from "./selrep";
import { replicaSpec } from "./spec";
import { STYLIZED_POSTPROCESSING, WHITE_BACKGROUND } from "./style";
import { TRACK_THEME_NAME, TrackColorThemeProvider, type TrackPaint } from "./track-theme";
import { AS_MODELED, pickFromLoci, type ClickMeta, type PickInfo } from "./viewer";

// One switchboard box: a headless Mol* plugin showing a whole model as a small replica of
// what the main view holds. The box owns nothing about WHAT to show: the switchboard hands
// it a desired state (model, facet, mirrored selection and overrides, looking glass) and
// one reconcile loop applies whatever changed, in a fixed order. The order matters the same
// way the main view's effect order does: a facet change rewrites every representation's
// params, which drops the selection marks, so the selection is always the last stage.

/** how the replica is painted */
export type ReplicaFacet =
  | { kind: "ghost" }
  | { kind: "color"; mode: RepColorMode; ramp: ConformerRamp }
  | { kind: "track"; paint: TrackPaint };

export interface ReplicaModel {
  /** identity of the loaded text: a change reloads the box */
  key: string;
  text: string;
  split: CompSplit;
  color: number;
}

export interface ReplicaGlass extends LookingGlass {
  /** a clip sphere always draws; a camera-derived one only while it is a fraction of the model */
  always: boolean;
}

/** the whole model translucent, so mirrored selections and overrides read through it */
const GHOST_TRANSPARENCY = 0.55;
/** a camera-derived looking glass is hidden once the main view frames most of the model */
const GLASS_MAX_FRACTION = 0.6;

type Stage = "load" | "facet" | "selRep" | "glass" | "selection";

export class ReplicaViewer {
  ctx: PluginContext | null = null;
  /** fired after a model finished loading (its bounding sphere is known) */
  onLoaded: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private initPromise: Promise<void> | null = null;
  private disposed = false;
  private structureRef: string | null = null;
  private sphere: FitSphere | null = null;
  private selRepRefs = new Map<string, string>();
  private glassRefs: LookingGlassRefs | null = null;

  private model: ReplicaModel | null = null;
  private facet: ReplicaFacet = { kind: "ghost" };
  private selRep: readonly SelRepOverlay[] = [];
  private glass: ReplicaGlass | null = null;
  private selection: LabSelection = EMPTY_SELECTION;
  private dirty = new Set<Stage>();
  private running = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async init(container: HTMLElement, colorThemes: readonly ColorTheme.Provider<any, any>[] = []): Promise<void> {
    if (this.ctx) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit(container, colorThemes);
    return this.initPromise;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async doInit(container: HTMLElement, extraThemes: readonly ColorTheme.Provider<any, any>[]): Promise<void> {
    const ctx = new PluginContext(replicaSpec);
    await ctx.init();
    if (this.disposed) {
      ctx.dispose();
      return;
    }
    if (!(await ctx.mountAsync(container))) {
      ctx.dispose();
      throw new Error("WebGL is unavailable for a switchboard box");
    }
    const registry = ctx.representation.structure.themes.colorThemeRegistry;
    for (const provider of [TrackColorThemeProvider, ...extraThemes]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!registry.has(provider as any)) registry.add(provider as any);
    }
    // The main view's look minus the ambient occlusion (the costly pass, invisible at this
    // size); the camera never refits by itself, the pose group places it.
    ctx.canvas3d?.setProps({
      postprocessing: {
        outline: STYLIZED_POSTPROCESSING.outline,
        occlusion: { name: "off", params: {} },
        shadow: { name: "off", params: {} },
      },
      renderer: {
        backgroundColor: WHITE_BACKGROUND,
        pickingAlphaThreshold: 0.1,
        highlightColor: Color(0x93b3d1),
        dimStrength: 0,
      },
      // no orientation gizmo: the box is turned like the main view, which has one
      camera: { manualReset: true, helper: { axes: { name: "off", params: {} } } },
      // Rotation only: the box always frames its whole model. Done through the speeds, which
      // are per plugin; the trackball BINDINGS object is one shared module-level default in
      // Mol* 5.11, so unbinding pan and zoom here would unbind them in the main view too.
      trackball: { zoomSpeed: 0, panSpeed: 0, gestureScaleFactor: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    ctx.managers.structure.component.setOptions({
      ...ctx.managers.structure.component.state.options,
      ignoreLight: true,
    });
    this.ctx = ctx;
    this.schedule();
  }

  get camera(): Camera | null {
    return this.ctx?.canvas3d?.camera ?? null;
  }

  /** the loaded model's bounding sphere; null before the first load lands */
  get fitSphere(): FitSphere | null {
    return this.sphere;
  }

  handleResize(): void {
    this.ctx?.handleResize();
  }

  // --- desired state ---

  setModel(model: ReplicaModel | null): void {
    if (model?.key === this.model?.key) return;
    this.model = model;
    this.mark("load");
  }

  setFacet(facet: ReplicaFacet): void {
    this.facet = facet;
    this.mark("facet");
  }

  setSelRep(overlays: readonly SelRepOverlay[]): void {
    this.selRep = overlays;
    this.mark("selRep");
  }

  setGlass(glass: ReplicaGlass | null): void {
    this.glass = glass;
    this.mark("glass");
  }

  setSelection(selection: LabSelection): void {
    this.selection = selection;
    this.mark("selection");
  }

  /** mirror a hover from elsewhere: marks the residues, clears on null */
  highlight(ranges: readonly ResidueRange[] | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const highlights = ctx.managers.interactivity.lociHighlights;
    const structure = this.structure();
    if (!ranges || !structure) {
      highlights.clearHighlights();
      return;
    }
    let loci: StructureElement.Loci | null = null;
    for (const range of ranges) {
      const part = residueLoci(structure, range.chain, range.from, range.to);
      if (part) loci = loci ? StructureElement.Loci.union(loci, part) : part;
    }
    if (loci) highlights.highlightOnly({ loci }, false);
    else highlights.clearHighlights();
  }

  subscribeToHover(callback: (info: PickInfo | null) => void): () => void {
    if (!this.ctx) return () => {};
    const subscription = this.ctx.behaviors.interaction.hover.subscribe((e) => callback(pickFromLoci(e)));
    return () => subscription.unsubscribe();
  }

  subscribeToClick(callback: (info: PickInfo | null, meta: ClickMeta) => void): () => void {
    if (!this.ctx) return () => {};
    const subscription = this.ctx.behaviors.interaction.click.subscribe((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const button = (e as any).button;
      callback(pickFromLoci(e), { button: typeof button === "number" ? button : 1 });
    });
    return () => subscription.unsubscribe();
  }

  dispose(): void {
    this.disposed = true;
    this.ctx?.dispose();
    this.ctx = null;
    this.initPromise = null;
  }

  // --- reconcile ---

  private mark(stage: Stage): void {
    this.dirty.add(stage);
    this.schedule();
  }

  private take(stage: Stage): boolean {
    return this.dirty.delete(stage);
  }

  private schedule(): void {
    if (this.running || !this.ctx || this.disposed) return;
    this.running = true;
    void this.reconcile()
      .catch((e) => {
        console.error("switchboard box failed:", e);
        this.onError?.(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        this.running = false;
        if (this.dirty.size && !this.disposed) this.schedule();
      });
  }

  private async reconcile(): Promise<void> {
    while (this.dirty.size) {
      const ctx = this.ctx;
      if (!ctx || this.disposed) return;
      if (this.take("load")) {
        await this.load(ctx);
        for (const stage of ["facet", "selRep", "glass", "selection"] as const) this.dirty.add(stage);
        continue;
      }
      if (this.take("glass")) {
        await this.applyGlass(ctx);
        continue;
      }
      const structureRef = this.structureRef;
      const model = this.model;
      if (!structureRef || !model) {
        this.dirty.clear();
        return;
      }
      if (this.take("facet")) {
        await this.applyFacet(ctx, structureRef, model);
        this.dirty.add("selection");
        continue;
      }
      if (this.take("selRep")) {
        await syncSelRepOverlays(
          ctx,
          structureRef,
          this.selRepRefs,
          this.selRep,
          { ...this.style(), colorMode: "element" },
          { uniformColor: model.color },
        );
        continue;
      }
      if (this.take("selection")) this.applySelection(ctx);
    }
  }

  private style(): RepStyle {
    const facet = this.facet;
    return {
      ...DEFAULT_REP_STYLE,
      type: "cartoon",
      colorMode: facet.kind === "color" ? facet.mode : "model",
      ramp: facet.kind === "color" ? facet.ramp : DEFAULT_REP_STYLE.ramp,
    };
  }

  private structure(): Structure | undefined {
    if (!this.ctx || !this.structureRef) return undefined;
    return this.ctx.state.data.cells.get(this.structureRef)?.obj?.data as Structure | undefined;
  }

  private async load(ctx: PluginContext): Promise<void> {
    await PluginCommands.State.RemoveObject(ctx, {
      state: ctx.state.data,
      ref: ctx.state.data.tree.root.ref,
      removeParentGhosts: true,
    });
    this.structureRef = null;
    this.sphere = null;
    this.selRepRefs.clear();
    this.glassRefs = null;
    const model = this.model;
    if (!model) return;
    const raw = await ctx.builders.data.rawData({ data: model.text, label: model.key });
    const trajectory = await ctx.builders.structure.parseTrajectory(raw, "mmcif");
    const modelNode = await ctx.builders.structure.createModel(trajectory);
    const structure = await ctx.builders.structure.createStructure(modelNode, AS_MODELED);
    if (this.disposed) return;
    await ensureLabComponents(ctx, structure.ref, model.split, this.style(), { uniformColor: model.color });
    this.structureRef = structure.ref;
    const boundary = structure.data?.boundary.sphere;
    this.sphere = boundary ? { center: Vec3.clone(boundary.center), radius: boundary.radius } : null;
    this.onLoaded?.();
  }

  private async applyFacet(ctx: PluginContext, structureRef: string, model: ReplicaModel): Promise<void> {
    const facet = this.facet;
    await applyRepStyle(ctx, structureRef, this.style(), {
      uniformColor: model.color,
      colorOverride:
        facet.kind === "track" ? { color: TRACK_THEME_NAME, colorParams: { paint: facet.paint } } : undefined,
    });
    if (facet.kind === "color" && facet.mode === "conformer") {
      // the card look's per-count fade on the trace (clears the previous layers itself)
      await applyConformerStyling(ctx, structureRef, planConformers(null), {
        shown: new Set(),
        globalAlt: null,
        polymerAsTrace: true,
        polymerFade: facet.ramp,
      });
      return;
    }
    const components = componentsForStructure(ctx, structureRef);
    if (!components.length) return;
    await clearStructureTransparency(ctx, components);
    if (facet.kind === "ghost") {
      await setStructureTransparency(
        ctx,
        components.filter((c) => !isOverlayComponent(c)),
        GHOST_TRANSPARENCY,
        async (root) => structureToLoci(root),
      );
    }
  }

  private async applyGlass(ctx: PluginContext): Promise<void> {
    const glass = this.glass;
    const shown =
      glass && (glass.always || !this.sphere || glass.radius < GLASS_MAX_FRACTION * this.sphere.radius) ? glass : null;
    this.glassRefs = await ensureLookingGlass(ctx, this.glassRefs, shown);
  }

  private applySelection(ctx: PluginContext): void {
    const structure = this.structure();
    if (!structure) return;
    const selects = ctx.managers.interactivity.lociSelects;
    const expression = selectionExpression(this.selection);
    const loci = expression ? executeQuery(expression, structure) : null;
    if (loci) {
      selects.selectOnly({ loci }, false);
      return;
    }
    selects.deselectAll();
    ctx.managers.structure.selection.clear();
  }
}
