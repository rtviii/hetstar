import type { AtomTable } from "@dynamic-pdb/hetkit/model";
import type { MapSampler, Track } from "@dynamic-pdb/hetkit/metrics";
import type { PluginContext } from "molstar/lib/mol-plugin/context";

import { getSourceGrid, makeGridSampler } from "./carve";
import {
  colorReprByVolume,
  colorReprUniform,
  createMetricVolume,
  removeNode,
  type MetricPoint,
} from "./density";

// The generic track-to-density projection call: any residue Track becomes a splatted
// metric volume painted onto density representations via the external-volume theme.

/** Sampler over the volume at `volumeRef`, reading the PRISTINE grid when the volume was
 * carved. `relative` yields sigma units (full-cell stats). Null when the ref resolves to
 * nothing. */
export function samplerForVolume(
  ctx: PluginContext,
  volumeRef: string | null,
  opts: { relative?: boolean } = {},
): MapSampler | null {
  if (!volumeRef) return null;
  const data = ctx.state.data.cells.get(volumeRef)?.obj?.data;
  const grid = getSourceGrid(data);
  if (!grid) return null;
  return makeGridSampler(grid, opts);
}

/** Flatten a residue track onto a model's heavy atoms: one MetricPoint per heavy atom of
 * every residue with a finite value (matched by residue key, so the track may come from
 * another model of the same entry — the pair-metric case splats from both models). */
export function trackToPoints(table: AtomTable, track: Track): MetricPoint[] {
  const byKey = new Map<string, number>();
  track.keys.forEach((k, i) => {
    const v = track.values[i];
    if (!Number.isNaN(v)) byKey.set(`${k.chain}|${k.seq}|${k.ins}`, v);
  });
  const points: MetricPoint[] = [];
  table.residues.forEach((res) => {
    const v = byKey.get(`${res.ref.chain}|${res.ref.seq}|${res.ref.ins}`);
    if (v === undefined) return;
    for (const r of res.rows) {
      const e = table.element[r];
      if (e === "H" || e === "D") continue;
      points.push({ x: table.x[r], y: table.y[r], z: table.z[r], value: v });
    }
  });
  return points;
}

export interface ProjectOptions {
  points: MetricPoint[];
  targets: (string | null)[];
  domain: [number, number];
  colors?: number[];
  spacing?: number;
  radius?: number;
  label?: string;
}

/** Owns the lifecycle of one projected metric volume: re-projecting replaces the volume
 * and re-colors the targets; clear() restores uniform colors and deletes the volume. */
export class MetricProjector {
  private volumeRef: string | null = null;
  private coloredTargets: string[] = [];

  getVolumeRef(): string | null {
    return this.volumeRef;
  }

  /** Sampler over the current metric volume (absolute values), e.g. for the slice panel. */
  sampler(ctx: PluginContext): MapSampler | null {
    return samplerForVolume(ctx, this.volumeRef, { relative: false });
  }

  async project(ctx: PluginContext, opts: ProjectOptions): Promise<void> {
    if (!opts.points.length) throw new Error("no points to project (empty scope?)");
    const previous = this.volumeRef;
    const volumeRef = await createMetricVolume(ctx, opts.points, {
      spacing: opts.spacing ?? 1,
      radius: opts.radius ?? 2.5,
      label: opts.label ?? "Metric field",
    });
    const targets = opts.targets.filter((t): t is string => !!t);
    for (const t of targets) await colorReprByVolume(ctx, t, volumeRef, opts.domain, { colors: opts.colors });
    this.volumeRef = volumeRef;
    this.coloredTargets = targets;
    // Delete the old volume only after nothing references it anymore.
    if (previous) await removeNode(ctx, previous);
  }

  /** Restore each colored target to a uniform color and drop the metric volume. */
  async clear(ctx: PluginContext, uniformColors: Map<string, number>): Promise<void> {
    for (const t of this.coloredTargets) {
      const c = uniformColors.get(t);
      if (c !== undefined) await colorReprUniform(ctx, t, c);
    }
    this.coloredTargets = [];
    if (this.volumeRef) {
      await removeNode(ctx, this.volumeRef);
      this.volumeRef = null;
    }
  }
}
