import { OrderedSet } from "molstar/lib/mol-data/int";
import { type Structure, StructureElement, Unit } from "molstar/lib/mol-model/structure";
import { clearStructureWiggle, setStructureWiggle } from "molstar/lib/mol-plugin-state/helpers/structure-wiggle";
import type { StructureComponentRef } from "molstar/lib/mol-plugin-state/manager/structure/hierarchy-state";
import type { PluginContext } from "molstar/lib/mol-plugin/context";

// Wiggling only a hard selection tears the bonds that cross its boundary: one end rides the noise
// field at full amplitude, the other is static. Instead we taper the amplitude outward from the
// selection in concentric shells (full at the selection + its bonded neighbours, fading to zero over
// ~6 Å). Because Mol*'s wiggle field is spatially smooth, a gentle amplitude gradient makes boundary
// bonds stretch slightly rather than snap. Each shell is one wiggle layer (setStructureWiggle appends).
const BANDS: { d: number; f: number }[] = [
  { d: 1.8, f: 1.0 }, // selection + directly bonded atoms
  { d: 3.2, f: 0.66 },
  { d: 4.6, f: 0.4 },
  { d: 6.0, f: 0.2 },
];

type ShellElements = { unit: Unit; indices: OrderedSet<StructureElement.UnitIndex> }[];

export async function setSelectionWiggleFalloff(
  plugin: PluginContext,
  components: StructureComponentRef[],
  root: Structure,
  selection: StructureElement.Loci,
  amplitude: number,
): Promise<void> {
  const shells = computeShells(root, selection, amplitude);
  await clearStructureWiggle(plugin, components);
  for (const shell of shells) {
    const loci = StructureElement.Loci(root, shell.elements);
    if (StructureElement.Loci.isEmpty(loci)) continue;
    await setStructureWiggle(plugin, components, shell.value, async () => loci);
  }
}

// Bucket every atom of `root` into a shell by its distance to the nearest selected atom; atoms
// beyond the outermost band are left untouched (amplitude 0). Distances use model coordinates, which
// match the displayed coordinates for a deposited (identity-operator) structure.
function computeShells(
  root: Structure,
  selection: StructureElement.Loci,
  amplitude: number,
): { value: number; elements: ShellElements }[] {
  const sx: number[] = [];
  const sy: number[] = [];
  const sz: number[] = [];
  for (const e of selection.elements) {
    const conf = e.unit.model.atomicConformation;
    OrderedSet.forEach(e.indices, (v) => {
      const ei = e.unit.elements[v];
      sx.push(conf.x[ei]);
      sy.push(conf.y[ei]);
      sz.push(conf.z[ei]);
    });
  }
  if (sx.length === 0) return [];

  const maxR2 = BANDS[BANDS.length - 1].d ** 2;
  const perShell: Map<Unit, number[]>[] = BANDS.map(() => new Map());
  for (const unit of root.units) {
    if (!Unit.isAtomic(unit)) continue;
    const conf = unit.model.atomicConformation;
    const els = unit.elements;
    for (let j = 0, jl = els.length; j < jl; j++) {
      const ei = els[j];
      const x = conf.x[ei];
      const y = conf.y[ei];
      const z = conf.z[ei];
      let best = Infinity;
      for (let s = 0; s < sx.length; s++) {
        const dx = x - sx[s];
        const dy = y - sy[s];
        const dz = z - sz[s];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) {
          best = d2;
          if (best === 0) break;
        }
      }
      if (best > maxR2) continue;
      const d = Math.sqrt(best);
      let si = -1;
      for (let b = 0; b < BANDS.length; b++) {
        if (d < BANDS[b].d) {
          si = b;
          break;
        }
      }
      if (si < 0) continue;
      let arr = perShell[si].get(unit);
      if (!arr) {
        arr = [];
        perShell[si].set(unit, arr);
      }
      arr.push(j);
    }
  }

  const shells: { value: number; elements: ShellElements }[] = [];
  for (let si = 0; si < BANDS.length; si++) {
    const elements: ShellElements = [];
    for (const [unit, idx] of perShell[si]) {
      idx.sort((a, b) => a - b);
      elements.push({
        unit,
        indices: OrderedSet.ofSortedArray(Int32Array.from(idx) as unknown as ArrayLike<StructureElement.UnitIndex>),
      });
    }
    if (elements.length > 0) shells.push({ value: amplitude * BANDS[si].f, elements });
  }
  return shells;
}
