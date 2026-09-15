import {
  Bond,
  type Model,
  Structure,
  StructureElement,
  StructureProperties,
  type Trajectory,
} from "molstar/lib/mol-model/structure";
import { Task } from "molstar/lib/mol-task";
import { createPluginUI } from "molstar/lib/mol-plugin-ui";
import { PluginUIContext } from "molstar/lib/mol-plugin-ui/context";
import { renderReact18 } from "molstar/lib/mol-plugin-ui/react18";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import { StateSelection } from "molstar/lib/mol-state";
import { Color } from "molstar/lib/mol-util/color";
import { MarkerAction } from "molstar/lib/mol-util/marker-action";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { AltLocColorThemeProvider } from "./altloc-theme";
import { setReprsPickable } from "./density";
import { buildComponentQuery, mergeExpressions } from "./queries";
import type { CompSplit } from "./repstyle";
import { labViewerSpec } from "./spec";
import {
  BALL_AND_STICK_COMPONENTS,
  DEFAULT_VIEW,
  POLYMER_COMPONENTS,
  POLYMER_ONLY_REPRESENTATIONS,
  type StructureView,
  STYLIZED_POSTPROCESSING,
  WHITE_BACKGROUND,
} from "./style";

export interface PickInfo {
  chainId: string;
  authSeqId: number;
  compId: string;
  /** label_atom_id of the picked atom */
  atomId: string;
  /** alternate-location letter of the picked atom; "" for shared atoms */
  altId: string;
  /** insertion code, "" when absent */
  insCode: string;
  /** the other end atom when the pick landed on a bond (mid-stick) */
  bondPartner?: { chainId: string; authSeqId: number; atomId: string };
  position3d?: [number, number, number];
}

export interface ClickMeta {
  /** Mol* button flag of the released button: 1 left, 2 right, 4 middle */
  button: number;
  /** viewport (client) coordinates of the click, when the event carries a page position */
  clientX?: number;
  clientY?: number;
  /** modifier keys held at release (Mol*'s ModifiersKeys), when the event carries them */
  modifiers?: { shift: boolean; alt: boolean; control: boolean; meta: boolean };
}

/**
 * Pure Mol* wrapper: owns the plugin lifecycle and exposes low-level operations
 * (load / highlight / focus / select / subscribe). No React, no app state. Runs the
 * chrome-free lab spec (lib/molstar/spec.ts): clicks belong to the app, and renderer
 * tweaks keep translucent ghost sticks pickable.
 */
export class MolstarViewer {
  ctx: PluginUIContext | null = null;
  private initPromise: Promise<void> | null = null;
  // Frame scrubbing: the state ref of the model-from-trajectory transform (whose modelIndex param we
  // update to switch frames) and the trajectory's total frame count.
  private modelRef: string | null = null;
  private modelCount = 1;
  // State ref of the parsed trajectory (all frames), for reading ensemble members off-tree.
  private trajectoryRef: string | null = null;
  // State ref of the primary structure (the one load()/buildRepresentation created), so callers can
  // target its hierarchy components (transparency/overpaint/clip) without guessing indices.
  private primaryStructureRef: string | null = null;

  async init(container: HTMLElement): Promise<void> {
    if (this.ctx) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit(container);
    return this.initPromise;
  }

  private async doInit(container: HTMLElement): Promise<void> {
    this.ctx = await createPluginUI({ target: container, spec: labViewerSpec, render: renderReact18 });
    // Register our custom alt-loc color theme so `color: 'alt-loc'` resolves on representations.
    if (!this.ctx.representation.structure.themes.colorThemeRegistry.has(AltLocColorThemeProvider)) {
      this.ctx.representation.structure.themes.colorThemeRegistry.add(AltLocColorThemeProvider);
    }
    this.applyDefaultStyling();
    // Ghost sticks: translucent geometry must stay hoverable/pickable (alpha above 0.1
    // still picks), hover marks in a light blue that reads on the pastel palette, and
    // nothing dims while a highlight is active. The pick buffer defaults to quarter
    // resolution (pickScale 0.25), which misses thin sticks; half resolution makes
    // clicks land where the cursor is.
    this.ctx.canvas3d?.setProps({
      pickScale: 0.5,
      renderer: { pickingAlphaThreshold: 0.1, highlightColor: Color(0x93b3d1), dimStrength: 0 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  private applyDefaultStyling(): void {
    if (!this.ctx) return;
    // Illustrative look: white canvas + outline + ambient occlusion,
    // and a flat (unlit) material on every representation.
    this.ctx.canvas3d?.setProps({
      postprocessing: STYLIZED_POSTPROCESSING,
      renderer: { backgroundColor: WHITE_BACKGROUND },
      // Never let an implicit scene change (e.g. adding a representation) auto-refit the camera.
      // The camera only moves on the explicit resetCamera() after load and focusLoci() on pin.
      camera: { manualReset: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    this.ctx.managers.structure.component.setOptions({
      ...this.ctx.managers.structure.component.state.options,
      ignoreLight: true,
    });
  }

  handleResize(): void {
    this.ctx?.canvas3d?.handleResize();
  }

  // --- data loading (parses + applies a flat ball-and-stick representation) ---

  async load(data: string | Uint8Array, opts: { label?: string; view?: StructureView } = {}): Promise<void> {
    if (!this.ctx) throw new Error("Viewer not initialized");
    const raw = await this.ctx.builders.data.rawData({
      data: data as string | Uint8Array<ArrayBuffer>,
      label: opts.label,
    });
    if (!this.ctx) throw new Error("Viewer disposed during load");
    const trajectory = await this.ctx.builders.structure.parseTrajectory(raw, "mmcif");
    if (!this.ctx) throw new Error("Viewer disposed during load");
    this.trajectoryRef = trajectory.ref;
    await this.buildRepresentation(trajectory, opts.view ?? DEFAULT_VIEW);
  }

  /**
   * Add a SECOND structure to the existing state tree without touching the primary
   * load/clear lifecycle or the frame-scrubbing refs. Rendered ball-and-stick in one
   * uniform color so the two models read apart. With `split` the components are the
   * lab's tagged expression components (lab-polymer/het/ion — what applyRepStyle
   * expects) instead of Mol*'s static kinds. Returns the structure's state ref
   * (toggle it with setSubtreeVisibility; a viewer.clear() removes it with everything
   * else). Format defaults to mmCIF.
   */
  async loadSecondary(
    data: string | Uint8Array,
    opts: { label?: string; format?: "mmcif" | "pdb"; color?: number; split?: CompSplit } = {},
  ): Promise<string | null> {
    const ctx = this.ctx;
    if (!ctx) throw new Error("Viewer not initialized");
    const raw = await ctx.builders.data.rawData({
      data: data as string | Uint8Array<ArrayBuffer>,
      label: opts.label ?? "secondary structure",
    });
    if (!this.ctx) throw new Error("Viewer disposed during load");
    const trajectory = await ctx.builders.structure.parseTrajectory(raw, opts.format ?? "mmcif");
    if (!this.ctx) throw new Error("Viewer disposed during load");
    const model = await ctx.builders.structure.createModel(trajectory);
    if (!this.ctx) return null;
    const structure = await ctx.builders.structure.createStructure(model);
    if (!this.ctx) return null;
    const reprProps = {
      type: "ball-and-stick" as const,
      typeParams: { ignoreLight: true },
      color: "uniform" as const,
      colorParams: { value: Color(opts.color ?? 0x8a97a5) },
    };
    const reprRefs: string[] = [];
    if (opts.split) {
      const groups = [
        { comps: opts.split.polymer, tag: "lab-polymer" },
        { comps: opts.split.het, tag: "lab-het" },
        { comps: opts.split.ions, tag: "lab-ion" },
      ];
      for (const g of groups) {
        if (!g.comps.length) continue;
        const comp = await ctx.builders.structure.tryCreateComponentFromExpression(
          structure,
          mergeExpressions(g.comps.map(buildComponentQuery)),
          g.tag,
          { label: g.comps.join(", "), tags: [g.tag] },
        );
        if (!comp || !this.ctx) continue;
        const repr = await ctx.builders.structure.representation.addRepresentation(comp, reprProps);
        if (repr) reprRefs.push(repr.ref);
      }
    } else {
      for (const kind of BALL_AND_STICK_COMPONENTS) {
        const comp = await ctx.builders.structure.tryCreateComponentStatic(structure, kind);
        if (!comp || !this.ctx) continue;
        const repr = await ctx.builders.structure.representation.addRepresentation(comp, reprProps);
        if (repr) reprRefs.push(repr.ref);
      }
    }
    // The secondary model is a reference silhouette: its translucent geometry must never
    // intercept picks meant for the primary (PickInfo carries no structure identity, so a
    // pick through the ghost would silently drive primary-side actions on the wrong model).
    setReprsPickable(ctx, reprRefs, false);
    return structure.ref;
  }

  // Build the structure from the trajectory's first model and render it with the requested
  // representation + colour theme (defaulting to the app's flat ball-and-stick look). Trace-based
  // representations (cartoon / putty) are restricted to the polymer; everything else covers all
  // non-solvent components. Records the model transform ref + frame count for frame scrubbing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildRepresentation(trajectory: any, view: StructureView): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.modelCount = trajectory?.data?.frameCount ?? 1;
    const model = await ctx.builders.structure.createModel(trajectory);
    if (!this.ctx) return;
    this.modelRef = model.ref;
    const structure = await ctx.builders.structure.createStructure(model);
    if (!this.ctx) return;
    this.primaryStructureRef = structure.ref;
    const components = POLYMER_ONLY_REPRESENTATIONS.includes(view.representation)
      ? POLYMER_COMPONENTS
      : BALL_AND_STICK_COMPONENTS;
    for (const kind of components) {
      const comp = await ctx.builders.structure.tryCreateComponentStatic(structure, kind);
      if (!comp || !this.ctx) continue;
      await ctx.builders.structure.representation.addRepresentation(comp, {
        type: view.representation,
        typeParams: { ignoreLight: true },
        color: view.colorTheme as ColorTheme.BuiltIn,
        ...(view.colorTheme === "uniform" ? { colorParams: { value: Color(view.uniformColor ?? 0xcfd8dc) } } : {}),
      });
    }
  }

  // --- multi-model frame scrubbing ---

  getModelCount(): number {
    return this.modelCount;
  }

  // Switch the visible frame by updating the model-from-trajectory transform's (zero-based)
  // modelIndex; Mol* recomputes the structure + representations downstream automatically.
  async setModelIndex(index: number): Promise<void> {
    if (!this.ctx || !this.modelRef) return;
    await this.ctx.state.data
      .build()
      .to(this.modelRef)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update((old: any) => ({ ...old, modelIndex: index }))
      .commit();
  }

  /**
   * Read one ensemble member's Model straight off the parsed trajectory — no state-tree
   * writes, no effect on the displayed frame. For multi-model mmCIF the frames are plain
   * models (sync); the Task branch covers computed trajectories.
   */
  async getFrameModel(index: number): Promise<Model | null> {
    if (!this.ctx || !this.trajectoryRef) return null;
    const cell = this.ctx.state.data.select(StateSelection.Generators.byRef(this.trajectoryRef))[0];
    const traj = cell?.obj?.data as Trajectory | undefined;
    if (!traj || index < 0 || index >= traj.frameCount) return null;
    const frame = traj.getFrameAtIndex(index);
    return Task.is(frame) ? await this.ctx.runTask(frame) : frame;
  }

  async clear(): Promise<void> {
    this.modelRef = null;
    this.modelCount = 1;
    this.trajectoryRef = null;
    this.primaryStructureRef = null;
    this.prevHighlight = null;
    if (!this.ctx) return;
    await PluginCommands.State.RemoveObject(this.ctx, {
      state: this.ctx.state.data,
      ref: this.ctx.state.data.tree.root.ref,
      removeParentGhosts: true,
    });
  }

  // --- camera ---

  resetCamera(durationMs = 250): void {
    if (!this.ctx) return;
    PluginCommands.Camera.Reset(this.ctx, { durationMs });
  }

  // --- structure access (for building queries) ---

  getCurrentStructure(): Structure | undefined {
    return this.ctx?.managers.structure.hierarchy.current.structures[0]?.cell.obj?.data;
  }

  getPrimaryStructureRef(): string | null {
    return this.primaryStructureRef;
  }

  // --- highlight / focus / selection ---

  // the loci this class last marked directly on the canvas (see highlightLoci)
  private prevHighlight: StructureElement.Loci | null = null;

  highlightLoci(loci: StructureElement.Loci | null): void {
    if (!this.ctx) return;
    if (!loci || StructureElement.Loci.isEmpty(loci)) {
      this.ctx.managers.interactivity.lociHighlights.clearHighlights();
    } else {
      // highlightOnly, not highlight: plain highlight() ACCUMULATES marks, so sweeping
      // the cursor across the barplot lit up every residue passed over at once.
      this.ctx.managers.interactivity.lociHighlights.highlightOnly({ loci }, false);
    }
    // The manager only BOOKKEEPS: actual marking runs through the providers registered
    // by the HighlightLoci behavior, and the lab spec disables that provider
    // (mark: false — its automatic raw-loci marking traced transparency-hidden ghost
    // conformers). So mark the canvas directly as well, clearing our previous mark by
    // hand; in specs where the provider is live the two paths mark the same loci and
    // the actions coalesce.
    const canvas = this.ctx.canvas3d;
    if (!canvas) return;
    if (this.prevHighlight) {
      canvas.mark({ loci: this.prevHighlight }, MarkerAction.RemoveHighlight);
      this.prevHighlight = null;
    }
    if (loci && !StructureElement.Loci.isEmpty(loci)) {
      canvas.mark({ loci }, MarkerAction.Highlight);
      this.prevHighlight = loci;
    }
  }

  focusLoci(loci: StructureElement.Loci, durationMs = 250): void {
    if (!this.ctx || StructureElement.Loci.isEmpty(loci)) return;
    this.ctx.managers.camera.focusLoci(loci, { durationMs });
  }

  clearSelection(): void {
    this.ctx?.managers.interactivity.lociSelects.deselectAll();
    this.ctx?.managers.structure.selection.clear();
  }

  // Routed through lociSelects (not structure.selection.fromLoci) so the SelectLoci
  // behavior's mark provider runs: the selection gets Mol*'s default green marker tint
  // in the canvas, and re-marks itself when representations rebuild. applyGranularity
  // must be false: the default (true) expands atom loci to whole residues under
  // "residue" granularity, silently erasing atom-precise selections.
  setSelection(loci: StructureElement.Loci): void {
    this.ctx?.managers.interactivity.lociSelects.selectOnly({ loci }, false);
  }

  // Pick/hover granularity of the interactivity manager (what the hover highlight marks).
  // Clicks are unaffected — the click event carries the raw atom-precise loci either way.
  setGranularity(granularity: "residue" | "element"): void {
    this.ctx?.managers.interactivity.setProps({ granularity });
  }

  // --- interaction events ---

  subscribeToHover(callback: (info: PickInfo | null) => void): () => void {
    if (!this.ctx) return () => {};
    const sub = this.ctx.behaviors.interaction.hover.subscribe((e) => callback(pickFromLoci(e)));
    return () => sub.unsubscribe();
  }

  // Fires for ANY button (Mol* already rejects drags: no click when the pointer moved
  // more than ~4 px between down and up), with a fresh synchronous pick at the release
  // point — unlike hover, which is async and throttled. meta.button uses Mol*'s flags:
  // 1 = left, 2 = right, 4 = middle. clientX/Y are viewport coordinates for anchoring
  // DOM popups, present when the event carries a page position.
  subscribeToClick(callback: (info: PickInfo | null, meta: ClickMeta) => void): () => void {
    if (!this.ctx) return () => {};
    const sub = this.ctx.behaviors.interaction.click.subscribe((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = e as any;
      const meta: ClickMeta = { button: typeof ev.button === "number" ? ev.button : 1 };
      if (ev.modifiers) {
        meta.modifiers = {
          shift: !!ev.modifiers.shift,
          alt: !!ev.modifiers.alt,
          control: !!ev.modifiers.control,
          meta: !!ev.modifiers.meta,
        };
      }
      // e.page is element-relative CSS pixels (clientXY minus the canvas rect)
      if (ev.page) {
        const canvasEl = this.ctx?.canvas3d?.webgl.gl.canvas;
        const rect = canvasEl instanceof HTMLElement ? canvasEl.getBoundingClientRect() : null;
        if (rect) {
          meta.clientX = rect.left + ev.page[0];
          meta.clientY = rect.top + ev.page[1];
        }
      }
      callback(pickFromLoci(e), meta);
    });
    return () => sub.unsubscribe();
  }

  dispose(): void {
    this.ctx?.dispose();
    this.ctx = null;
    this.initPromise = null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickFromLoci(e: any): PickInfo | null {
  let loci = e?.current?.loci;
  // A pick on a STICK is a Bond.Loci, not an atom. Mol* only converts bond -> atom when
  // the cursor is within the first atom's radius; mid-stick picks arrive here as bonds
  // and used to be dropped (most of the clickable area in a ball-and-stick scene).
  // Resolve to BOTH end atoms — the first fills the pick, the second becomes bondPartner
  // so atom-mode selection can take the whole bond.
  const isBond = Bond.isLoci(loci) && loci.bonds.length > 0;
  if (isBond) loci = Bond.toStructureElementLoci(loci);
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return null;
  let info: PickInfo | null = null;
  StructureElement.Loci.forEachLocation(loci, (location) => {
    if (info) {
      if (isBond && !info.bondPartner) {
        info.bondPartner = {
          chainId: StructureProperties.chain.auth_asym_id(location),
          authSeqId: StructureProperties.residue.auth_seq_id(location),
          atomId: StructureProperties.atom.label_atom_id(location),
        };
      }
      return;
    }
    const rawIns = StructureProperties.residue.pdbx_PDB_ins_code(location);
    info = {
      chainId: StructureProperties.chain.auth_asym_id(location),
      authSeqId: StructureProperties.residue.auth_seq_id(location),
      compId: StructureProperties.atom.label_comp_id(location),
      atomId: StructureProperties.atom.label_atom_id(location),
      altId: StructureProperties.atom.label_alt_id(location) ?? "",
      insCode: rawIns === "?" || rawIns === "." ? "" : (rawIns ?? ""),
      position3d: e.position
        ? [e.position[0], e.position[1], e.position[2]]
        : [
            StructureProperties.atom.x(location),
            StructureProperties.atom.y(location),
            StructureProperties.atom.z(location),
          ],
    };
  });
  return info;
}
