import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { Vec4 } from "molstar/lib/mol-math/linear-algebra/3d/vec4";
import { EmptyLoci } from "molstar/lib/mol-model/loci";
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
import { PluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import {
  clearStructureOverpaint,
  setStructureOverpaint,
} from "molstar/lib/mol-plugin-state/helpers/structure-overpaint";
import {
  clearStructureTransparency,
  setStructureTransparency,
} from "molstar/lib/mol-plugin-state/helpers/structure-transparency";
import {
  clearStructureWiggle,
  setStructureWiggleFromUncertainty,
} from "molstar/lib/mol-plugin-state/helpers/structure-wiggle";
import {
  StructureSelectionFromExpression,
  TransformStructureConformation,
} from "molstar/lib/mol-plugin-state/transforms/model";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import { StateSelection } from "molstar/lib/mol-state";
import { Color } from "molstar/lib/mol-util/color";
import { MarkerAction } from "molstar/lib/mol-util/marker-action";
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { AltLocColorThemeProvider } from "./altloc-theme";
import { setReprsPickable } from "./density";
import { LabelManager } from "./labels";
import {
  type AltGroupSelector,
  type BondEnd,
  buildAltGroupExpression,
  buildBondAtomsExpression,
  buildComponentQuery,
  buildTlsGroupExpression,
  executeQuery,
  mergeExpressions,
} from "./queries";
import type { CompSplit } from "./repstyle";
import { setSelectionWiggleFalloff } from "./wiggle-falloff";
import { labViewerSpec, proposalViewerSpec, viewerSpec } from "./spec";
import {
  BALL_AND_STICK_COMPONENTS,
  DEFAULT_VIEW,
  POLYMER_COMPONENTS,
  POLYMER_ONLY_REPRESENTATIONS,
  type StructureView,
  STYLIZED_POSTPROCESSING,
  WHITE_BACKGROUND,
} from "./style";
import { type TlsGroup, TLS_EXAGGERATION, TLS_MAX_ANGLE_DEG, TLS_PALETTE, tlsTransformParams } from "./tls";

interface TlsRef {
  ref: string;
  axis: Vec3;
  origin: Vec3;
  amp: number;
}

// One heterogeneity network prepared for rendering: a colour and the membership selectors that pick
// its atoms. Built by the inspector from the parsed het model; the viewer turns each into its own
// coloured, independently toggleable sub-structure.
export interface HetVizNetwork {
  id: string;
  color: number;
  selectors: AltGroupSelector[];
}

// The constant "base" part is drawn grey (matches the alt-loc theme's "no alt" colour).
const HET_BASE_COLOR = 0xcfd8dc;

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
 * Which spec/behavior bundle the plugin runs with:
 *  - "default": full Mol* default behaviors (main inspector).
 *  - "minimal": chrome-free, atom-granularity picking (proposal figures).
 *  - "lab":     chrome-free with FocusLoci / camera-fly / hover-toast behaviors REMOVED —
 *               clicks belong to the app — plus renderer tweaks for the ghost-stick look.
 */
export type ViewerVariant = "default" | "minimal" | "lab";

/**
 * Pure Mol* wrapper — owns the plugin lifecycle and exposes low-level operations
 * (load / highlight / focus / select / subscribe). No React, no app state. Adapted
 * from the fend_tubulinxyz `MolstarViewer`, generalised for arbitrary structures.
 */
export class MolstarViewer {
  ctx: PluginUIContext | null = null;
  private initPromise: Promise<void> | null = null;
  private labelManager: LabelManager | null = null;
  // Frame scrubbing: the state ref of the model-from-trajectory transform (whose modelIndex param we
  // update to switch frames) and the trajectory's total frame count.
  private modelRef: string | null = null;
  private modelCount = 1;
  // State ref of the parsed trajectory (all frames), for reading ensemble members off-tree.
  private trajectoryRef: string | null = null;
  // State ref of the primary structure (the one load()/buildRepresentation created), so callers can
  // target its hierarchy components (transparency/overpaint/clip) without guessing indices.
  private primaryStructureRef: string | null = null;
  // TLS libration: one transformable sub-structure per rigid body, plus the running animation handle.
  private tlsRefs: TlsRef[] = [];
  private tlsRaf: number | null = null;
  // Heterogeneity networks (colour + membership selectors). The whole structure is drawn as ONE
  // representation; networks are coloured by overpaint and hidden (state stepper) by transparency, so
  // every bond stays drawn and nothing floats. Kept here to recompute those layers on each state step.
  private hetNetworks: HetVizNetwork[] = [];

  // Variant picks the spec (see ViewerVariant). `minimal: true` is kept as an alias of
  // variant "minimal" for the existing figure call sites.
  async init(container: HTMLElement, opts: { minimal?: boolean; variant?: ViewerVariant } = {}): Promise<void> {
    if (this.ctx) return;
    if (this.initPromise) return this.initPromise;
    const variant: ViewerVariant = opts.variant ?? (opts.minimal ? "minimal" : "default");
    const spec = variant === "minimal" ? proposalViewerSpec : variant === "lab" ? labViewerSpec : viewerSpec;
    this.initPromise = this.doInit(container, spec, variant);
    return this.initPromise;
  }

  private async doInit(container: HTMLElement, spec: PluginUISpec, variant: ViewerVariant): Promise<void> {
    this.ctx = await createPluginUI({ target: container, spec, render: renderReact18 });
    // Register our custom alt-loc color theme so `color: 'alt-loc'` resolves on representations.
    if (!this.ctx.representation.structure.themes.colorThemeRegistry.has(AltLocColorThemeProvider)) {
      this.ctx.representation.structure.themes.colorThemeRegistry.add(AltLocColorThemeProvider);
    }
    this.applyDefaultStyling(variant === "minimal");
    if (variant === "minimal") {
      // Hover/click highlight one atom, not the enclosing residue.
      this.ctx.managers.interactivity.setProps({ granularity: "element" });
    }
    if (variant === "lab") {
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
  }

  private applyDefaultStyling(minimal = false): void {
    if (!this.ctx) return;
    // Illustrative look (à la fend_tubulinxyz): white canvas + outline + ambient occlusion,
    // and a flat (unlit) material on every representation.
    this.ctx.canvas3d?.setProps({
      postprocessing: STYLIZED_POSTPROCESSING,
      renderer: { backgroundColor: WHITE_BACKGROUND },
      // Never let an implicit scene change (e.g. adding a representation) auto-refit the camera.
      // The camera only moves on the explicit resetCamera() after load and focusLoci() on pin.
      // For minimal figures, also drop the bottom-left axes gizmo.
      camera: { manualReset: true, ...(minimal ? { helper: { axes: { name: "off", params: {} } } } : {}) },
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

  async load(
    data: string | Uint8Array,
    opts: { label?: string; view?: StructureView; tlsGroups?: TlsGroup[]; het?: HetVizNetwork[] } = {},
  ): Promise<void> {
    if (!this.ctx) throw new Error("Viewer not initialized");
    const raw = await this.ctx.builders.data.rawData({
      data: data as string | Uint8Array<ArrayBuffer>,
      label: opts.label,
    });
    if (!this.ctx) throw new Error("Viewer disposed during load");
    const trajectory = await this.ctx.builders.structure.parseTrajectory(raw, "mmcif");
    if (!this.ctx) throw new Error("Viewer disposed during load");
    this.trajectoryRef = trajectory.ref;
    if (opts.het && opts.het.length) await this.buildHeterogeneity(trajectory, opts.het);
    else if (opts.tlsGroups && opts.tlsGroups.length) await this.buildTls(trajectory, opts.tlsGroups);
    else await this.buildRepresentation(trajectory, opts.view ?? DEFAULT_VIEW);
  }

  /**
   * Add a SECOND structure to the existing state tree without touching the primary
   * load/clear lifecycle or the frame-scrubbing refs. Rendered ball-and-stick in one
   * uniform color so the two models read apart. With `split` the components are the
   * lab's tagged expression components (lab-polymer/het/ion — what applyRepStyle
   * expects) instead of Mol*'s static kinds. Returns the structure's state ref
   * (toggle it with setSubtreeVisibility; a viewer.clear() removes it with everything
   * else). Format defaults to mmCIF; "pdb" covers the re-refined corpus files.
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

  async loadFromUrl(url: string, opts: { binary?: boolean; label?: string; view?: StructureView } = {}): Promise<void> {
    if (!this.ctx) throw new Error("Viewer not initialized");
    const raw = await this.ctx.builders.data.download({
      url,
      isBinary: !!opts.binary,
      label: opts.label,
    });
    if (!this.ctx) throw new Error("Viewer disposed during load");
    const trajectory = await this.ctx.builders.structure.parseTrajectory(raw, "mmcif");
    if (!this.ctx) throw new Error("Viewer disposed during load");
    await this.buildRepresentation(trajectory, opts.view ?? DEFAULT_VIEW);
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

  // --- TLS rigid-body libration ---

  // Render each TLS group as its own sub-structure (so it can be moved independently), coloured per
  // group, with a transform-structure-conformation node we animate. Replaces the default
  // representation; called instead of buildRepresentation when TLS groups are supplied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildTls(trajectory: any, groups: TlsGroup[]): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.modelCount = trajectory?.data?.frameCount ?? 1;
    const model = await ctx.builders.structure.createModel(trajectory);
    if (!this.ctx) return;
    this.modelRef = model.ref;
    const structure = await ctx.builders.structure.createStructure(model);
    if (!this.ctx) return;
    this.primaryStructureRef = structure.ref;
    this.tlsRefs = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const b = ctx.state.data.build().to(structure.ref);
      const sel = b.apply(StructureSelectionFromExpression, {
        expression: buildTlsGroupExpression(g.chain, g.ranges),
        label: `TLS ${g.id}`,
      });
      const xf = sel.apply(TransformStructureConformation, tlsTransformParams(g.axis, 0, g.origin));
      await b.commit();
      if (!this.ctx) return;
      await ctx.builders.structure.representation.addRepresentation(xf.ref, {
        type: "ball-and-stick",
        typeParams: { ignoreLight: true },
        color: "uniform",
        colorParams: { value: Color(TLS_PALETTE[i % TLS_PALETTE.length]) },
      });
      this.tlsRefs.push({ ref: xf.ref, axis: g.axis, origin: g.origin, amp: g.amplitudeDeg });
    }
  }

  hasTls(): boolean {
    return this.tlsRefs.length > 0;
  }

  // Animate every TLS group rocking about its principal libration axis (a gentle shared sinusoid;
  // amplitudes per group come from the L tensor, exaggerated for visibility).
  startTlsAnimation(): void {
    if (this.tlsRaf !== null || !this.tlsRefs.length || !this.ctx) return;
    const t0 = performance.now();
    const freq = 0.25; // Hz
    const tick = () => {
      if (this.tlsRaf === null) return;
      const ctx = this.ctx;
      if (!ctx) {
        this.tlsRaf = null;
        return;
      }
      const phase = Math.sin(2 * Math.PI * freq * ((performance.now() - t0) / 1000));
      const b = ctx.state.data.build();
      for (const g of this.tlsRefs) {
        const amp = Math.min(TLS_EXAGGERATION * g.amp, TLS_MAX_ANGLE_DEG);
        b.to(g.ref).update(tlsTransformParams(g.axis, amp * phase, g.origin));
      }
      void b.commit().then(() => {
        if (this.tlsRaf !== null) this.tlsRaf = requestAnimationFrame(tick);
      });
    };
    this.tlsRaf = requestAnimationFrame(tick);
  }

  stopTlsAnimation(resetToRest = true): void {
    if (this.tlsRaf !== null) {
      cancelAnimationFrame(this.tlsRaf);
      this.tlsRaf = null;
    }
    if (resetToRest && this.ctx && this.tlsRefs.length) {
      const b = this.ctx.state.data.build();
      for (const g of this.tlsRefs) b.to(g.ref).update(tlsTransformParams(g.axis, 0, g.origin));
      void b.commit();
    }
  }

  isTlsAnimating(): boolean {
    return this.tlsRaf !== null;
  }

  // --- heterogeneity networks (proposed extension) ---

  // Draw the WHOLE structure as one ball-and-stick representation (grey), then colour each network in
  // place with overpaint. Splitting networks into their own components (the old approach) left every
  // altloc side chain's bond to the shared, grey backbone undrawn — the bond spanned two separate
  // representations — so the side chains floated. One representation keeps every bond; overpaint adds
  // colour without new geometry; transparency (the state stepper) hides a network's atoms.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildHeterogeneity(trajectory: any, networks: HetVizNetwork[]): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.modelCount = trajectory?.data?.frameCount ?? 1;
    const model = await ctx.builders.structure.createModel(trajectory);
    if (!this.ctx) return;
    this.modelRef = model.ref;
    const structure = await ctx.builders.structure.createStructure(model);
    if (!this.ctx) return;
    this.primaryStructureRef = structure.ref;
    this.hetNetworks = networks;

    // one hierarchy-tracked component for the whole structure (so overpaint/transparency can target it)
    const comp = await ctx.builders.structure.tryCreateComponentStatic(structure, "all");
    if (!this.ctx) return;
    if (comp) {
      await ctx.builders.structure.representation.addRepresentation(comp, {
        type: "ball-and-stick",
        typeParams: { ignoreLight: true },
        color: "uniform",
        colorParams: { value: Color(HET_BASE_COLOR) },
      });
    }
    if (!this.ctx) return;
    await this.applyNetworkColors();
    await this.showAllNetworks();
  }

  hasHet(): boolean {
    return this.hetNetworks.length > 0;
  }

  // Loci getter for a network's membership atoms, resolved against the (root) structure — the shape the
  // overpaint / transparency helpers expect.
  private netLoci(net: HetVizNetwork) {
    return async (root: Structure) => executeQuery(buildAltGroupExpression(net.selectors), root) ?? EmptyLoci;
  }

  // (Re)paint every network its colour. Overpaint recolours the atoms of the single representation in
  // place, so bonds to the grey backbone stay drawn.
  private async applyNetworkColors(): Promise<void> {
    if (!this.ctx) return;
    const comps = this.wiggleComponents();
    await clearStructureOverpaint(this.ctx, comps);
    for (const net of this.hetNetworks) {
      if (!this.ctx) return;
      await setStructureOverpaint(this.ctx, comps, Color(net.color), this.netLoci(net));
    }
  }

  // Show exactly the given networks (plus the always-visible base); hide the rest by making their
  // atoms transparent. Drives the state stepper — a state is base + its chosen networks.
  async setVisibleNetworks(ids: Set<string>): Promise<void> {
    if (!this.ctx) return;
    const comps = this.wiggleComponents();
    await clearStructureTransparency(this.ctx, comps);
    for (const net of this.hetNetworks) {
      if (!this.ctx) return;
      if (!ids.has(net.id)) await setStructureTransparency(this.ctx, comps, 1, this.netLoci(net));
    }
  }

  async showAllNetworks(): Promise<void> {
    await this.setVisibleNetworks(new Set(this.hetNetworks.map((n) => n.id)));
  }

  private hetLoci(id: string): StructureElement.Loci | null {
    const net = this.hetNetworks.find((n) => n.id === id);
    const struct = this.getCurrentStructure();
    if (!net || !struct) return null;
    return executeQuery(buildAltGroupExpression(net.selectors), struct);
  }

  highlightNetwork(id: string | null): void {
    this.highlightLoci(id ? this.hetLoci(id) : null);
  }

  focusNetwork(id: string): void {
    const loci = this.hetLoci(id);
    if (loci) this.focusLoci(loci);
  }

  // --- struct_conn bonds ---
  //
  // A bond is drawn by Mol* itself (it reads _struct_conn and renders metal coordination dashed),
  // so there is no geometry to add here — only the two ends to point at. Both helpers resolve
  // exactly the two named atoms, altloc included, so highlighting a bond of Thr26's carbonyl in
  // alternate B does not light up the same oxygen in A, C and D.

  private bondLoci(a: BondEnd, b: BondEnd): StructureElement.Loci | null {
    const struct = this.getCurrentStructure();
    if (!struct) return null;
    return executeQuery(buildBondAtomsExpression(a, b), struct);
  }

  highlightBond(ends: { a: BondEnd; b: BondEnd } | null): void {
    this.highlightLoci(ends ? this.bondLoci(ends.a, ends.b) : null);
  }

  focusBond(a: BondEnd, b: BondEnd): void {
    const loci = this.bondLoci(a, b);
    if (loci) this.focusLoci(loci);
  }

  // --- B-factor / selection "wiggle" (Mol*'s shader thermal animation) ---
  //
  // Unlike a per-atom random displacement (which tears bonds apart), Mol*'s wiggle samples one smooth
  // 3D noise field at each atom's position with a low spatial frequency, so neighbouring atoms move
  // together. It runs in the vertex shader (auto-animating, no per-frame state commits). Per-atom
  // amplitude comes from a loci "bundle": from B-factor for the whole structure, or from a selection.

  private wiggleComponents() {
    if (!this.ctx) return [];
    return this.ctx.managers.structure.hierarchy.current.structures.flatMap((s) => s.components);
  }

  // Global wiggle animation params: spatially-correlated ('position' mode), gentle speed; the base
  // amplitude is kept at 0 so only atoms covered by a bundle actually move.
  private async setWiggleGlobal(amplitude: number): Promise<void> {
    if (!this.ctx) return;
    const options = this.ctx.managers.structure.component.state.options;
    await this.ctx.managers.structure.component.setOptions({
      ...options,
      animation: {
        ...options.animation,
        wiggleMode: "position",
        wiggleSpeed: 7,
        wiggleFrequency: 0.2,
        wiggleAmplitude: amplitude,
        tumbleAmplitude: 0,
      },
    });
  }

  // Wiggle every atom with per-atom amplitude scaled by its B-factor / RMSF (Mol*'s "Uncertainty").
  async applyUncertaintyWiggle(scale = 1.2): Promise<void> {
    if (!this.ctx) return;
    const comps = this.wiggleComponents();
    await this.setWiggleGlobal(0);
    await clearStructureWiggle(this.ctx, comps);
    await setStructureWiggleFromUncertainty(this.ctx, comps, scale);
  }

  // Wiggle the currently selected atoms (whatever is pinned / selected), tapering the amplitude
  // outward so bonds at the selection boundary stretch instead of snapping.
  async wiggleSelection(amplitude = 1): Promise<void> {
    if (!this.ctx) return;
    const root = this.getCurrentStructure();
    if (!root) return;
    const sel = this.ctx.managers.structure.selection.getLoci(root);
    if (!StructureElement.Loci.is(sel) || StructureElement.Loci.isEmpty(sel)) return;
    await this.setWiggleGlobal(0);
    await setSelectionWiggleFalloff(this.ctx, this.wiggleComponents(), root, sel, amplitude);
  }

  async clearWiggle(): Promise<void> {
    if (!this.ctx) return;
    await clearStructureWiggle(this.ctx, this.wiggleComponents());
    await this.setWiggleGlobal(0);
  }

  hasSelection(): boolean {
    return !!this.ctx && this.ctx.managers.structure.selection.elementCount() > 0;
  }

  async clear(): Promise<void> {
    this.stopTlsAnimation(false);
    this.tlsRefs = [];
    this.hetNetworks = [];
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

  getStructureFromRef(ref: string): Structure | undefined {
    if (!this.ctx) return undefined;
    const cell = this.ctx.state.data.select(StateSelection.Generators.byRef(ref))[0];
    return cell?.obj?.data as Structure | undefined;
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

  setFocusFromLoci(loci: StructureElement.Loci): void {
    this.ctx?.managers.structure.focus.setFromLoci(loci);
  }

  clearFocus(): void {
    this.ctx?.managers.structure.focus.clear();
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

  // --- in-scene labels (tethered text anchored to a loci) ---

  private ensureLabelManager(): LabelManager | null {
    if (this.labelManager) return this.labelManager;
    if (!this.ctx) return null;
    this.labelManager = new LabelManager(this.ctx);
    return this.labelManager;
  }

  showHoverLabel(loci: StructureElement.Loci, text: string, color?: Color): void {
    const m = this.ensureLabelManager();
    if (m) void m.showHover(loci, text, color);
  }

  hideHoverLabel(): void {
    this.labelManager?.hideHover();
  }

  addPersistentLabel(key: string, loci: StructureElement.Loci, text: string, color?: Color): void {
    const m = this.ensureLabelManager();
    if (m) void m.addPersistent(key, loci, text, color);
  }

  removePersistentLabel(key: string): void {
    this.labelManager?.removePersistent(key);
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

  // --- 3D -> screen projection (for DOM labels anchored to atoms) ---

  projectToScreen(position3d: [number, number, number]): { x: number; y: number } | null {
    const canvas3d = this.ctx?.canvas3d;
    if (!canvas3d) return null;
    const camera = canvas3d.camera;
    const viewport = camera.viewport;
    const point = Vec3.create(position3d[0], position3d[1], position3d[2]);
    const projected = Vec4.create(0, 0, 0, 0);
    camera.project(projected, point);
    const canvasEl = canvas3d.webgl.gl.canvas;
    const rect = canvasEl instanceof HTMLElement ? canvasEl.getBoundingClientRect() : null;
    if (!rect) return null;
    const scale = viewport.width / rect.width;
    return {
      x: projected[0] / scale + rect.left + window.scrollX,
      y: (viewport.height - projected[1]) / scale + rect.top + window.scrollY,
    };
  }

  subscribeToDidDraw(callback: () => void): () => void {
    const canvas3d = this.ctx?.canvas3d;
    if (!canvas3d) return () => {};
    const sub = canvas3d.didDraw.subscribe(callback);
    return () => sub.unsubscribe();
  }

  dispose(): void {
    this.stopTlsAnimation(false);
    this.tlsRefs = [];
    this.hetNetworks = [];
    this.labelManager?.dispose();
    this.labelManager = null;
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
