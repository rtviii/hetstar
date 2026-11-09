"use client";
import { useMemo } from "react";
import {
  hetcifComponents,
  hetcifTableFor,
  hetcifWorlds,
  type HetcifModel,
  type HetcifWorld,
} from "@dynamic-pdb/hetkit/model";
import { altColorCss } from "../../lib/molstar/altloc-theme";
import { SectionLabel, SwitchButton, TinyText, Tooltip } from "./ui";

// The world chooser for a file that carries hetcif categories (~/dev/hetcif): one state per
// variable. The default is the most probable world; the user moves single variables (those
// touching the selected residues) or whole correlated groups (components with more than one
// variable, listed with their legal worlds and joint probabilities). It replaces the naive
// per-letter toggle, which assumed letters were coupled across residues.

export interface WorldPanelProps {
  model: HetcifModel;
  /** marginal P(variable = state), keyed `${variable}|${state}` */
  marginals: Map<string, number>;
  /** the world in force: top world with the user's overrides applied */
  world: Record<string, string>;
  /** variables the user moved off the top world */
  overridden: ReadonlySet<string>;
  /** variables touching the current selection, in file order */
  selectedVariables: string[];
  disabled?: boolean;
  onChoose: (variable: string, state: string) => void;
  onChooseMany: (states: Record<string, string>) => void;
  onReset: () => void;
}

const MAX_WORLDS = 8;

function worldLabel(w: HetcifWorld): string {
  return Object.entries(w.states)
    .map(([v, s]) => `${v}=${s}`)
    .join(" + ");
}

export default function WorldPanel({
  model,
  marginals,
  world,
  overridden,
  selectedVariables,
  disabled,
  onChoose,
  onChooseMany,
  onReset,
}: WorldPanelProps) {
  const groups = useMemo(
    () =>
      hetcifComponents(model)
        .filter((c) => c.length > 1)
        .map((c) => ({ variables: c, worlds: hetcifWorlds(model, c).sort((a, b) => b.p - a.p) })),
    [model],
  );
  const nTables = model.tables.size;
  const nVars = model.variables.size;

  const variableRow = (vid: string) => {
    const v = model.variables.get(vid);
    if (!v) return null;
    const table = hetcifTableFor(model, vid);
    return (
      <div key={vid} className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tooltip
          content={
            <div className="flex flex-col gap-1">
              <div className="font-medium">
                {vid} ({v.kind ?? "unknown"}, {v.provenance ?? "unknown"})
              </div>
              {v.details && <div>{v.details}</div>}
              {table && (
                <div>
                  distribution owned by table {table.id}, given {table.parents.join(", ")}
                  {table.details ? `: ${table.details}` : ""}
                </div>
              )}
            </div>
          }
        >
          <span className={`cursor-help font-mono text-[11px] ${overridden.has(vid) ? "text-ink" : "text-ink-secondary"}`}>
            {vid}
            {table && <span className="text-ink-muted"> | {table.parents.join(", ")}</span>}
          </span>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-1">
          {v.states.map((s) => {
            const p = marginals.get(`${vid}|${s.id}`) ?? 0;
            const hasAtoms = s.members.length > 0;
            return (
              <SwitchButton
                key={s.id}
                pressed={world[vid] === s.id}
                disabled={disabled}
                title={`${s.details ?? s.id}: p = ${p.toFixed(3)}${hasAtoms ? "" : " (no atoms)"}`}
                onClick={() => onChoose(vid, s.id)}
              >
                <span className="flex items-center gap-1">
                  {hasAtoms && /^[A-Z]$/.test(s.id) && (
                    <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: altColorCss(s.id) }} />
                  )}
                  {s.id}
                  <span className="tabular-nums text-ink-muted">{p.toFixed(2)}</span>
                </span>
              </SwitchButton>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tooltip
          content={
            <div className="flex flex-col gap-1">
              <div className="font-medium">World, model A</div>
              <div>
                The file names {nVars} state variables{nTables ? ` and ${nTables} conditional tables` : ""}. One state per variable
                is shown; the default is the most probable world. Move a variable with its buttons, a correlated group with
                one of its listed worlds. Expanded residues (selection actions) show every conformer regardless.
              </div>
            </div>
          }
        >
          <span className="cursor-help">
            <SectionLabel>World</SectionLabel>
          </span>
        </Tooltip>
        <SwitchButton pressed={overridden.size === 0} disabled={disabled} onClick={onReset}>
          top world
        </SwitchButton>
        {overridden.size > 0 && (
          <TinyText>
            {overridden.size} variable{overridden.size === 1 ? "" : "s"} moved
          </TinyText>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <TinyText>correlated groups (joint probability of each legal world)</TinyText>
          {groups.map((g) => (
            <div key={g.variables.join("+")} className="flex flex-col gap-1">
              <div className="font-mono text-[11px] text-ink-secondary">{g.variables.join(" + ")}</div>
              <div className="flex flex-wrap gap-1">
                {g.worlds.slice(0, MAX_WORLDS).map((w) => {
                  const active = g.variables.every((v) => world[v] === w.states[v]);
                  return (
                    <SwitchButton
                      key={worldLabel(w)}
                      pressed={active}
                      disabled={disabled}
                      title={worldLabel(w)}
                      onClick={() => onChooseMany(w.states)}
                    >
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        {g.variables.map((v) => w.states[v]).join("/")}
                        <span className="tabular-nums text-ink-muted">{w.p.toFixed(2)}</span>
                      </span>
                    </SwitchButton>
                  );
                })}
                {g.worlds.length > MAX_WORLDS && <TinyText>+{g.worlds.length - MAX_WORLDS} more</TinyText>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {selectedVariables.length ? (
          <>
            <TinyText>variables of the selected residues (state, marginal p)</TinyText>
            {selectedVariables.map(variableRow)}
          </>
        ) : (
          <TinyText>select a residue to move its variables; groups above move together</TinyText>
        )}
      </div>
    </div>
  );
}
