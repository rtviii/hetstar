"use client";
import { useMemo, type ReactNode } from "react";

import { WATER_COMPS } from "@/lib/lab/entries";
import { ROLE_LABELS, type EntryManifest } from "@/lib/dpdb/types";
import { isPolymerComp, type AltlocSummary, type AtomTable, type EntryDescription } from "@dynamic-pdb/hetkit/model";
import { SectionLabel, TinyText } from "./ui";

// The sidebar's entry card: what this structure IS — ids, title, experiment facts,
// per-model global metrics, composition — in compact landing-page form. Facts come from
// the deposited CIF's header (hetkit describeEntry) with the dpdb catalogue overlaid for
// live entries; absent fields simply do not render.

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-line-strong bg-white px-1.5 py-px font-mono text-[10.5px] text-ink-secondary">
      {children}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-ink-muted">{label}</span>
      <span className="min-w-0 break-words text-ink-secondary">{children}</span>
    </>
  );
}

/** "X-RAY DIFFRACTION" reads like a header; render it as prose */
function prettyMethod(m: string): string {
  return m === m.toUpperCase() ? m.charAt(0) + m.slice(1).toLowerCase() : m;
}

export default function EntryCard({
  entry,
  desc,
  aTable,
  altSummary,
  memberCount,
}: {
  entry: EntryManifest | null;
  /** header facts from the deposited CIF (falls back to model A's own header) */
  desc: EntryDescription | null;
  aTable: AtomTable | null;
  altSummary: AltlocSummary | null;
  /** MODEL frames of model A; > 1 marks an ensemble */
  memberCount: number;
}) {
  const cat = entry?.catalogue ?? null;

  // registry-computed facts of model A
  const stats = useMemo(() => {
    if (!aTable) return null;
    let polymerResidues = 0;
    const chains = new Set<string>();
    const ligands = new Map<string, number>();
    for (const res of aTable.residues) {
      if (WATER_COMPS.has(res.compId)) continue;
      if (isPolymerComp(res.compId)) {
        polymerResidues++;
        chains.add(res.ref.chain);
      } else {
        ligands.set(res.compId, (ligands.get(res.compId) ?? 0) + 1);
      }
    }
    return {
      atoms: aTable.count,
      polymerResidues,
      chains: chains.size,
      splitResidues: altSummary?.residues.length ?? 0,
      ligands: [...ligands.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [aTable, altSummary]);

  if (!entry) {
    return <TinyText>load an entry to see its description here</TinyText>;
  }

  const firstEntity = desc?.entities.find((e) => e.type === "polymer") ?? desc?.entities[0] ?? null;
  const title = desc?.title ?? entry.title;
  const method = desc?.method ?? cat?.method ?? null;
  const resolution = desc?.resolution ?? entry.resolution;
  const spaceGroup = desc?.spaceGroup ?? cat?.spaceGroup ?? null;
  const tempK = desc?.temperatureK ?? cat?.growthTempK ?? null;
  const ph = desc?.ph ?? cat?.growthPh ?? null;
  const organism = firstEntity?.organism ?? cat?.entities[0]?.organism ?? null;
  const uniprot = firstEntity?.uniprot ?? cat?.entities[0]?.uniprot ?? null;
  const modelsWithMetrics = entry.models.filter((m) => Object.keys(m.metrics).length > 0);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        {/* the ids live in the EntryChip right above this card — no chips repeated here */}
        {title && <div className="text-[11.5px] leading-snug text-ink-secondary">{title}</div>}
        {memberCount > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <Chip>{memberCount} members</Chip>
          </div>
        )}
        {cat?.details && <TinyText>{cat.details}</TinyText>}
      </div>

      <div className="grid grid-cols-[auto,1fr] items-baseline gap-x-2.5 gap-y-1 text-[10.5px] tabular-nums">
        {method && <Fact label="Method">{prettyMethod(method)}</Fact>}
        {resolution != null && <Fact label="Resolution">{resolution.toFixed(2)} A</Fact>}
        {spaceGroup && <Fact label="Space group">{spaceGroup}</Fact>}
        {tempK != null && <Fact label="Temperature">{tempK.toFixed(0)} K</Fact>}
        {ph != null && <Fact label="pH">{ph}</Fact>}
        {organism && <Fact label="Organism">{organism}</Fact>}
        {uniprot && <Fact label="UniProt">{uniprot}</Fact>}
        {desc?.depositedDate && <Fact label="Deposited">{desc.depositedDate}</Fact>}
        {cat?.publishedAt && <Fact label="Published (dpdb)">{cat.publishedAt.slice(0, 10)}</Fact>}
        {desc?.firstAuthor && (
          <Fact label="Authors">
            {desc.firstAuthor}
            {desc.authorCount > 1 ? ` et al. (${desc.authorCount})` : ""}
          </Fact>
        )}
      </div>

      {stats && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <SectionLabel>Model A</SectionLabel>
          <div className="grid grid-cols-[auto,1fr] items-baseline gap-x-2.5 gap-y-1 text-[10.5px] tabular-nums">
            <Fact label="Atoms">{stats.atoms.toLocaleString()}</Fact>
            <Fact label="Residues">
              {stats.polymerResidues.toLocaleString()} in {stats.chains} chain{stats.chains === 1 ? "" : "s"}
            </Fact>
            {stats.splitResidues > 0 && (
              <Fact label="With alternates">
                {stats.splitResidues} ({stats.polymerResidues ? Math.round((100 * stats.splitResidues) / stats.polymerResidues) : 0}%)
              </Fact>
            )}
            {memberCount > 1 && <Fact label="Ensemble">{memberCount} MODEL frames</Fact>}
            {desc?.rWork != null && (
              <Fact label="R-work / R-free">
                {desc.rWork.toFixed(3)}
                {desc.rFree != null ? ` / ${desc.rFree.toFixed(3)}` : ""}
              </Fact>
            )}
          </div>
        </div>
      )}

      {modelsWithMetrics.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <SectionLabel>Catalogue metrics</SectionLabel>
          <div className="flex flex-col gap-0.5 text-[10.5px] tabular-nums text-ink-secondary">
            {modelsWithMetrics.map((m) => {
              const bits: string[] = [];
              if (m.metrics.r_work != null || m.metrics.r_free != null)
                bits.push(`R ${m.metrics.r_work?.toFixed(3) ?? "-"} / ${m.metrics.r_free?.toFixed(3) ?? "-"}`);
              if (m.metrics.clashscore != null) bits.push(`clash ${m.metrics.clashscore.toFixed(1)}`);
              if (m.metrics.ramachandran_outliers != null) bits.push(`rama out ${m.metrics.ramachandran_outliers.toFixed(1)}%`);
              return (
                <div key={m.id}>
                  <span className="text-ink-muted">{ROLE_LABELS[m.role]}: </span>
                  {bits.join(" · ")}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats && stats.ligands.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <SectionLabel>Ligands and ions</SectionLabel>
          <div className="flex flex-wrap gap-1">
            {stats.ligands.map(([comp, n]) => (
              <Chip key={comp}>
                {comp}
                {n > 1 ? ` x${n}` : ""}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <TinyText>
        source: {entry.source === "dpdb" ? "Dynamic PDB catalogue" : "bundled entry"}; facts from the deposited mmCIF
        header{entry.source === "dpdb" ? " and the catalogue" : ""}
      </TinyText>
    </div>
  );
}
