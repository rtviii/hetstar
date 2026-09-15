import type { StructureElement } from "molstar/lib/mol-model/structure";
import type { PluginContext } from "molstar/lib/mol-plugin/context";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";

// Thin wrapper over Mol*'s StructureMeasurementManager for the lab's distance tools
// (conformer spread, two-point measure). Measurements are shape representations under
// the plugin's "measurement-group" node: they auto-update when structures change
// (member scrubs included) and die with viewer.clear(). All lab measurements carry
// MEASURE_TAG so they can be enumerated/cleared without touching anything else —
// today nothing else creates measurements, but the tag keeps that assumption local.

export const MEASURE_TAG = "hetstar-measure";

/** Dashed line + Å label between two loci; loci may live in different structures. */
export async function addDistanceMeasurement(
  ctx: PluginContext,
  a: StructureElement.Loci,
  b: StructureElement.Loci,
  opts: { customText?: string } = {},
): Promise<void> {
  await ctx.managers.structure.measurement.addDistance(a, b, {
    customText: opts.customText,
    selectionTags: MEASURE_TAG,
    reprTags: MEASURE_TAG,
    // Mol* defaults (linesSize 0.075, textSize 0.5, borderWidth 0.2) are sized for its
    // own viewer; against the lab's thin sticks (ball-and-stick sizeFactor 0.15) they
    // read fat and chunky — slim the dashes well below the stick radius and shrink
    // the label to a discreet annotation.
    visualParams: { linesSize: 0.03, dashLength: 0.1, textSize: 0.22, borderWidth: 0.08 },
  });
}

export function measurementCount(ctx: PluginContext): number {
  return ctx.managers.structure.measurement.state.distances.length;
}

/** Remove every distance measurement (each cell's parent is its Selections node). */
export async function clearMeasurements(ctx: PluginContext): Promise<void> {
  const cells = [...ctx.managers.structure.measurement.state.distances];
  for (const cell of cells) {
    await PluginCommands.State.RemoveObject(ctx, {
      state: ctx.state.data,
      ref: cell.transform.parent,
      removeParentGhosts: true,
    });
  }
}
