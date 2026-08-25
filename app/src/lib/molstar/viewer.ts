import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { Vec4 } from "molstar/lib/mol-math/linear-algebra/3d/vec4";
import { EmptyLoci } from "molstar/lib/mol-model/loci";
import {
  Structure,
  StructureElement,
  StructureProperties,
} from "molstar/lib/mol-model/structure";
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
import type { ColorTheme } from "molstar/lib/mol-theme/color";
import { AltLocColorThemeProvider } from "./altloc-theme";
import { LabelManager } from "./labels";
import {
  type AltGroupSelector,
  type BondEnd,
  buildAltGroupExpression,
  buildBondAtomsExpression,
  buildTlsGroupExpression,
  executeQuery,
} from "./queries";
import { setSelectionWiggleFalloff } from "./wiggle-falloff";
import { proposalViewerSpec, viewerSpec } from "./spec";
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
  position3d?: [number, number, number];
}

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
  // TLS libration: one transformable sub-structure per rigid body, plus the running animation handle.
  private tlsRefs: TlsRef[] = [];
  private tlsRaf: number | null = null;
  // Heterogeneity networks (colour + membership selectors). The whole structure is drawn as ONE
  // representation; networks are coloured by overpaint and hidden (state stepper) by transparency, so
  // every bond stays drawn and nothing floats. Kept here to recompute those layers on each state step.
  private hetNetworks: HetVizNetwork[] = [];

  // `minimal` (proposal explainer figures): use the chrome-free spec (no viewport button strip),
  // hide the camera axes gizmo, and pick at atom granularity so hovering highlights one atom rather
  // than the whole residue. The default (main inspector) keeps Mol*'s standard chrome and residue picking.
  async init(container: HTMLElement, opts: { minimal?: boolean } = {}): Promise<void> {
    if (this.ctx) return;
    if (this.initPromise) return this.initPromise;
    const spec = opts.minimal ? proposalViewerSpec : viewerSpec;
    this.initPromise = this.doInit(container, spec, !!opts.minimal);
    return this.initPromise;
  }

  private async doInit(container: HTMLElement, spec: PluginUISpec, minimal: boolean): Promise<void> {
    this.ctx = await createPluginUI({ target: container, spec, render: renderReact18 });
    // Register our custom alt-loc color theme so `color: 'alt-loc'` resolves on representations.
    if (!this.ctx.representation.structure.themes.colorThemeRegistry.has(AltLocColorThemeProvider)) {
      this.ctx.representation.structure.themes.colorThemeRegistry.add(AltLocColorThemeProvider);
    }
    this.applyDefaultStyling(minimal);
    if (minimal) {
      // Hover/click highlight one atom, not the enclosing residue.
      this.ctx.managers.interactivity.setProps({ granularity: "element" });
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
    if (opts.het && opts.het.length) await this.buildHeterogeneity(trajectory, opts.het);
    else if (opts.tlsGroups && opts.tlsGroups.length) await this.buildTls(trajectory, opts.tlsGroups);
    else await this.buildRepresentation(trajectory, opts.view ?? DEFAULT_VIEW);
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

  getStructureFromRef(ref: string): Structure | undefined {
    if (!this.ctx) return undefined;
    const cell = this.ctx.state.data.select(StateSelection.Generators.byRef(ref))[0];
    return cell?.obj?.data as Structure | undefined;
  }

  // --- highlight / focus / selection ---

  highlightLoci(loci: StructureElement.Loci | null): void {
    if (!this.ctx) return;
    if (!loci || StructureElement.Loci.isEmpty(loci)) {
      this.ctx.managers.interactivity.lociHighlights.clearHighlights();
    } else {
      this.ctx.managers.interactivity.lociHighlights.highlight({ loci }, false);
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

  setSelection(loci: StructureElement.Loci): void {
    this.ctx?.managers.structure.selection.fromLoci("set", loci);
  }

  addToSelection(loci: StructureElement.Loci): void {
    this.ctx?.managers.structure.selection.fromLoci("add", loci);
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

  subscribeToClick(callback: (info: PickInfo | null) => void): () => void {
    if (!this.ctx) return () => {};
    const sub = this.ctx.behaviors.interaction.click.subscribe((e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((e as any).button === 2) return; // ignore right-click (context menu)
      callback(pickFromLoci(e));
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
  const loci = e?.current?.loci;
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return null;
  let info: PickInfo | null = null;
  StructureElement.Loci.forEachLocation(loci, (location) => {
    if (info) return;
    info = {
      chainId: StructureProperties.chain.auth_asym_id(location),
      authSeqId: StructureProperties.residue.auth_seq_id(location),
      compId: StructureProperties.atom.label_comp_id(location),
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
