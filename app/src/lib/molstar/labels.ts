import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { Vec4 } from "molstar/lib/mol-math/linear-algebra/3d/vec4";
import { StructureElement } from "molstar/lib/mol-model/structure";
import type { PluginUIContext } from "molstar/lib/mol-plugin-ui/context";
import type { Color } from "molstar/lib/mol-util/color";

// 2D HTML-overlay labels. Each label is a DOM node positioned over the canvas by projecting the
// loci's 3D centroid to screen space every frame (camera.project on canvas3d.didDraw). Unlike the
// previous in-scene Mol* shape labels, this adds NO geometry to the scene — so the camera never
// auto-refits ("yanks") on hover — and a DOM node stays a fixed readable size at any zoom and is
// clamped to stay on-screen. Replaces the fend_tubulinxyz-style shape LabelManager.

const HOVER_FALLBACK = 0x0ea5e9;

function toHex(color?: Color): string {
  const c = (color ?? HOVER_FALLBACK) as unknown as number;
  return `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface LabelNode {
  box: HTMLDivElement;
  label: HTMLSpanElement;
  caret: HTMLDivElement;
  center: Vec3;
}

export class LabelManager {
  private layer: HTMLDivElement | null = null;
  private drawSub: { unsubscribe: () => void } | null = null;
  private hover: LabelNode | null = null;
  private hoverActive = false;
  private persistent = new Map<string, LabelNode>();
  private readonly out = Vec4.create(0, 0, 0, 0);

  constructor(private plugin: PluginUIContext) {}

  private get canvas3d() {
    return this.plugin.canvas3d;
  }

  private ensureLayer(): HTMLDivElement | null {
    if (this.layer) return this.layer;
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:25;overflow:hidden;";
    document.body.appendChild(el);
    this.layer = el;
    const c = this.canvas3d;
    if (c) this.drawSub = c.didDraw.subscribe(() => this.updateAll());
    return el;
  }

  private makeNode(text: string, hex: string): LabelNode {
    const box = document.createElement("div");
    box.style.cssText =
      "position:absolute;display:none;transform:translate(-50%,calc(-100% - 9px));" +
      "padding:2px 7px;border-radius:5px;white-space:nowrap;" +
      "font:600 12px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#fff;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.35);will-change:left,top;";
    box.style.background = hex;
    const label = document.createElement("span");
    label.textContent = text;
    const caret = document.createElement("div");
    caret.style.cssText =
      "position:absolute;left:50%;bottom:-4px;transform:translateX(-50%);width:0;height:0;" +
      "border-left:4px solid transparent;border-right:4px solid transparent;";
    caret.style.borderTop = `5px solid ${hex}`;
    box.appendChild(label);
    box.appendChild(caret);
    return { box, label, caret, center: Vec3.create(0, 0, 0) };
  }

  private update(node: LabelNode, text: string, hex: string, loci: StructureElement.Loci): void {
    node.label.textContent = text;
    node.box.style.background = hex;
    node.caret.style.borderTop = `5px solid ${hex}`;
    const b = StructureElement.Loci.getBoundary(loci);
    Vec3.copy(node.center, b.sphere.center);
    this.place(node);
  }

  // Project the node's stored 3D centroid to viewport (fixed) coords, clamp into the canvas rect,
  // and hide it when the point is behind the camera.
  private place(node: LabelNode): void {
    const c = this.canvas3d;
    if (!c) return;
    const camera = c.camera;
    const viewport = camera.viewport;
    camera.project(this.out, node.center);
    // out[3] === 1/clip.w; <= 0 means the point is behind the camera.
    if (this.out[3] <= 0) {
      node.box.style.display = "none";
      return;
    }
    const canvasEl = c.webgl.gl.canvas;
    const rect = canvasEl instanceof HTMLElement ? canvasEl.getBoundingClientRect() : null;
    if (!rect || rect.width === 0) {
      node.box.style.display = "none";
      return;
    }
    const scale = viewport.width / rect.width; // device px -> css px
    const x = this.out[0] / scale + rect.left;
    const y = (viewport.height - this.out[1]) / scale + rect.top;
    const pad = 6;
    node.box.style.display = "";
    node.box.style.left = `${clamp(x, rect.left + pad, rect.right - pad)}px`;
    // keep room above the anchor for the box itself (~30px), so it never clips off the top
    node.box.style.top = `${clamp(y, rect.top + pad + 30, rect.bottom - pad)}px`;
  }

  private updateAll(): void {
    // Only re-place the hover node while hover is active. Without this guard, a frame redraw
    // (e.g. during fast source scroll) re-shows a node that hideHover() just hid, because
    // place() unconditionally sets display="".
    if (this.hover && this.hoverActive) this.place(this.hover);
    for (const n of this.persistent.values()) this.place(n);
  }

  showHover(loci: StructureElement.Loci, text: string, accentColor?: Color): void {
    const layer = this.ensureLayer();
    if (!layer) return;
    const hex = toHex(accentColor);
    if (!this.hover) {
      this.hover = this.makeNode(text, hex);
      layer.appendChild(this.hover.box);
    }
    this.hoverActive = true;
    this.update(this.hover, text, hex, loci);
  }

  hideHover(): void {
    this.hoverActive = false;
    if (this.hover) this.hover.box.style.display = "none";
  }

  addPersistent(
    key: string,
    loci: StructureElement.Loci,
    text: string,
    accentColor?: Color,
  ): void {
    const layer = this.ensureLayer();
    if (!layer) return;
    const hex = toHex(accentColor);
    this.removePersistent(key);
    const node = this.makeNode(text, hex);
    layer.appendChild(node.box);
    this.persistent.set(key, node);
    this.update(node, text, hex, loci);
  }

  removePersistent(key: string): void {
    const node = this.persistent.get(key);
    if (!node) return;
    node.box.remove();
    this.persistent.delete(key);
  }

  removeAllPersistent(): void {
    for (const key of [...this.persistent.keys()]) this.removePersistent(key);
  }

  dispose(): void {
    this.drawSub?.unsubscribe();
    this.drawSub = null;
    this.removeAllPersistent();
    this.hover?.box.remove();
    this.hover = null;
    this.layer?.remove();
    this.layer = null;
  }
}
