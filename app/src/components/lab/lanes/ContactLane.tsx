"use client";
import { memo, useMemo } from "react";

import { isHeavy, isPolymerComp, residueKey, type AtomTable } from "@dynamic-pdb/hetkit/model";
import { WATER_COMPS } from "@/lib/lab/entries";
import { spanStyle, type LaneModule, type LaneProps } from "./types";

// Ligand-contact lane, computed locally from model A: polymer residues with a heavy
// atom within CONTACT_R of any ligand/ion heavy atom, marked per contacting component.
// (PDBe's binding_sites endpoints are retired, and a distance criterion on the shown
// model is truer to the coordinates anyway — it follows the selected ensemble member.)

const CONTACT_R = 4.0;
const CONTACT_R2 = CONTACT_R * CONTACT_R;
const COLOR = "#3e8f7a";

interface ContactMark {
  /** residueKey of the polymer residue */
  key: string;
  /** contacting component ids, sorted */
  comps: string[];
}

const contactsCache = new WeakMap<AtomTable, Map<string, ContactMark[]>>();

/** auth chain -> contact marks; O(polymer heavy atoms x ligand heavy atoms), cached per table */
function ligandContacts(table: AtomTable): Map<string, ContactMark[]> {
  const hit = contactsCache.get(table);
  if (hit) return hit;
  const ligandRows: number[] = [];
  for (const res of table.residues) {
    if (isPolymerComp(res.compId) || WATER_COMPS.has(res.compId)) continue;
    for (const r of res.rows) if (isHeavy(table, r)) ligandRows.push(r);
  }
  const out = new Map<string, ContactMark[]>();
  if (ligandRows.length) {
    for (const res of table.residues) {
      if (!isPolymerComp(res.compId)) continue;
      const comps = new Set<string>();
      for (const r of res.rows) {
        if (!isHeavy(table, r)) continue;
        const x = table.x[r], y = table.y[r], z = table.z[r];
        for (const l of ligandRows) {
          const dx = x - table.x[l], dy = y - table.y[l], dz = z - table.z[l];
          if (dx * dx + dy * dy + dz * dz <= CONTACT_R2) comps.add(table.compId[l]);
        }
      }
      if (comps.size) {
        const list = out.get(res.ref.chain) ?? [];
        list.push({ key: residueKey(res.ref), comps: [...comps].sort() });
        out.set(res.ref.chain, list);
      }
    }
  }
  contactsCache.set(table, out);
  return out;
}

const ContactLaneView = memo(function ContactLaneView({ ctx, onSelectSpan }: LaneProps) {
  const marks = useMemo(() => {
    if (!ctx.aTable) return [];
    const list = ligandContacts(ctx.aTable).get(ctx.chain.chain) ?? [];
    return list
      .map((m) => ({ pos: ctx.chain.posByKey.get(m.key) ?? null, comps: m.comps }))
      .filter((m): m is { pos: number; comps: string[] } => m.pos !== null);
  }, [ctx.aTable, ctx.chain]);
  return (
    <>
      {marks.map((m, i) => (
        <span
          key={i}
          className="absolute inset-y-0 cursor-pointer opacity-70 hover:opacity-100"
          style={{ ...spanStyle({ start: m.pos, end: m.pos }, ctx.chain.length), background: COLOR, minWidth: 2 }}
          title={`contacts ${m.comps.join(", ")} (heavy atom within ${CONTACT_R} A)`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSelectSpan({ start: m.pos, end: m.pos });
          }}
        />
      ))}
    </>
  );
});

export const ligandContactLane: LaneModule = {
  id: "ligand-contacts",
  label: "Ligand contacts",
  description: `polymer residues with a heavy atom within ${CONTACT_R} A of a ligand or ion in model A; computed from the shown coordinates`,
  defaultOn: false,
  height: 12,
  unavailable: (ctx) => {
    if (!ctx.aTable) return "load a model";
    if (!ligandContacts(ctx.aTable).size) return "no ligands or ions in model A";
    if (!(ligandContacts(ctx.aTable).get(ctx.chain.chain) ?? []).length) return "none on this chain";
    return null;
  },
  Component: ContactLaneView,
  readout: (ctx, pos) => {
    if (!ctx.aTable) return null;
    const p = ctx.chain.positions[pos - 1];
    if (!p?.ref) return null;
    const key = residueKey(p.ref);
    const m = (ligandContacts(ctx.aTable).get(ctx.chain.chain) ?? []).find((x) => x.key === key);
    return m ? `contacts ${m.comps.join(", ")}` : null;
  },
};
