"use client";
import { useMemo, type ReactNode } from "react";

import { WATER_COMPS, type ProvenanceRecord } from "../../lib/lab/entries";
import { ROLE_LABELS, type EntryManifest } from "../../lib/dpdb/types";
import { isHeavy, isPolymerComp, type AltlocSummary, type AtomTable, type EntryDescription } from "@dynamic-pdb/hetkit/model";
import { Num, Section, TinyText } from "./ui";

// The rail's body: what this structure IS, grouped by concept, each group a section that
// folds (ui.tsx Section; the fold is remembered). Experiment, source, the model on screen,
// the entry's models with their global metrics, ligands, and the files everything was read
// from. Facts come from the deposited CIF's header (hetkit describeEntry) with the dpdb
// catalogue overlaid for live entries; an absent field does not render, an empty section
// does not either. Prose (the entry's details) stays folded until asked for.

const FOLD = "hetstar.rail.";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      {/* "pH" keeps its capitals in the label voice */}
      <dt data-case={label === "pH" ? "keep" : undefined}>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** "X-RAY DIFFRACTION" reads like a header; render it as prose */
function prettyMethod(m: string): string {
  return m === m.toUpperCase() ? m.charAt(0) + m.slice(1).toLowerCase() : m;
}

function metric(v: number | undefined, digits: number): string {
  return v == null ? "-" : v.toFixed(digits);
}

function FileRow({ p }: { p: ProvenanceRecord }) {
  const isHttp = !!p.url && /^https?:\/\//.test(p.url);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="hs-label">{p.role}</span>
        <span className="min-w-0 text-[10.5px] text-ink-secondary">{p.desc}</span>
      </div>
      {p.url &&
        (isHttp ? (
          <a href={p.url} target="_blank" rel="noreferrer" className="break-all font-mono text-[9.5px] leading-tight text-accent hover:underline">
            {p.url}
          </a>
        ) : (
          <div className="break-all font-mono text-[9.5px] leading-tight text-ink-muted">{p.url}</div>
        ))}
    </div>
  );
}

export default function EntryCard({
  entry,
  desc,
  aTable,
  altSummary,
  memberCount,
  provenance,
}: {
  entry: EntryManifest | null;
  /** header facts from the deposited CIF (falls back to model A's own header) */
  desc: EntryDescription | null;
  aTable: AtomTable | null;
  altSummary: AltlocSummary | null;
  /** MODEL frames of model A; > 1 marks an ensemble */
  memberCount: number;
  /** where each loaded file came from */
  provenance: ProvenanceRecord[];
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
    // heavy atoms only: hydrogens are never drawn, so they don't count either
    let atoms = 0;
    for (let r = 0; r < aTable.count; r++) if (isHeavy(aTable, r)) atoms++;
    return {
      atoms,
      polymerResidues,
      chains: chains.size,
      splitResidues: altSummary?.residues.length ?? 0,
      ligands: [...ligands.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [aTable, altSummary]);

  if (!entry) {
    return <TinyText className="px-2.5 py-2">Load an entry to see its description here.</TinyText>;
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
  const hasExperiment = !!method || resolution != null || !!spaceGroup || tempK != null || ph != null;
  const hasSource = !!organism || !!uniprot || !!desc?.depositedDate || !!cat?.publishedAt || !!desc?.firstAuthor;
  const splitPercent = stats && stats.polymerResidues ? Math.round((100 * stats.splitResidues) / stats.polymerResidues) : 0;

  return (
    <div className="flex flex-col">
      {(title || memberCount > 1) && (
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          {title && <div className="text-[11.5px] font-medium leading-snug text-ink">{title}</div>}
          {memberCount > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="hs-tag hs-tag-accent">{memberCount} members</span>
            </div>
          )}
        </div>
      )}

      {hasExperiment && (
        <Section
          title="Experiment"
          storageKey={`${FOLD}experiment`}
          summary={[method ? prettyMethod(method) : null, resolution != null ? `${resolution.toFixed(2)} Å` : null].filter(Boolean).join(" · ")}
        >
          <dl className="hs-kv">
            {method && <Row label="Method">{prettyMethod(method)}</Row>}
            {resolution != null && (
              <Row label="Resolution">
                <Num unit="Å">{resolution.toFixed(2)}</Num>
              </Row>
            )}
            {spaceGroup && (
              <Row label="Space group">
                <span className="hs-value">{spaceGroup}</span>
              </Row>
            )}
            {tempK != null && (
              <Row label="Temperature">
                <Num unit="K">{tempK.toFixed(0)}</Num>
              </Row>
            )}
            {ph != null && (
              <Row label="pH">
                <span className="hs-value">{ph}</span>
              </Row>
            )}
          </dl>
        </Section>
      )}

      {hasSource && (
        <Section title="Source" storageKey={`${FOLD}source`} summary={organism ?? undefined}>
          <dl className="hs-kv">
            {organism && <Row label="Organism">{organism}</Row>}
            {uniprot && (
              <Row label="UniProt">
                <span className="hs-value">{uniprot}</span>
              </Row>
            )}
            {desc?.firstAuthor && (
              <Row label="Authors">
                {desc.firstAuthor}
                {desc.authorCount > 1 && <span className="hs-unit"> et al. ({desc.authorCount})</span>}
              </Row>
            )}
            {desc?.depositedDate && (
              <Row label="Deposited">
                <span className="hs-value">{desc.depositedDate}</span>
              </Row>
            )}
            {cat?.publishedAt && (
              <Row label="In dpdb">
                <span className="hs-value">{cat.publishedAt.slice(0, 10)}</span>
              </Row>
            )}
          </dl>
        </Section>
      )}

      {stats && (
        <Section
          title="Model A"
          storageKey={`${FOLD}model`}
          summary={`${stats.polymerResidues.toLocaleString()} res${stats.splitResidues > 0 ? ` · ${splitPercent}% alt` : ""}`}
        >
          <dl className="hs-kv">
            <Row label="Atoms">
              <span className="hs-value">{stats.atoms.toLocaleString()}</span>
            </Row>
            <Row label="Residues">
              <Num unit={`in ${stats.chains} chain${stats.chains === 1 ? "" : "s"}`}>{stats.polymerResidues.toLocaleString()}</Num>
            </Row>
            {stats.splitResidues > 0 && (
              <Row label="Alternates">
                <Num unit={`residues, ${splitPercent}%`}>{stats.splitResidues}</Num>
              </Row>
            )}
            {memberCount > 1 && (
              <Row label="Ensemble">
                <Num unit="MODEL frames">{memberCount}</Num>
              </Row>
            )}
            {desc?.rWork != null && (
              <Row label="R-work/free">
                <span className="hs-value">
                  {desc.rWork.toFixed(3)}
                  {desc.rFree != null && (
                    <>
                      <span className="hs-unit"> / </span>
                      {desc.rFree.toFixed(3)}
                    </>
                  )}
                </span>
              </Row>
            )}
          </dl>
        </Section>
      )}

      {modelsWithMetrics.length > 0 && (
        <Section title="Catalogue metrics" count={modelsWithMetrics.length} storageKey={`${FOLD}metrics`} flush>
          <table className="hs-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="hs-num">R-work</th>
                <th className="hs-num">R-free</th>
                <th className="hs-num" title="clashscore">
                  Clash
                </th>
                <th className="hs-num" title="Ramachandran outliers, %">
                  Rama
                </th>
              </tr>
            </thead>
            <tbody>
              {modelsWithMetrics.map((m) => (
                <tr key={m.id}>
                  <td className="max-w-[84px] truncate font-sans text-[10.5px]" title={m.title}>
                    {ROLE_LABELS[m.role]}
                  </td>
                  <td className="hs-num">{metric(m.metrics.r_work, 3)}</td>
                  <td className="hs-num">{metric(m.metrics.r_free, 3)}</td>
                  <td className="hs-num">{metric(m.metrics.clashscore, 1)}</td>
                  <td className="hs-num">{metric(m.metrics.ramachandran_outliers, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {stats && stats.ligands.length > 0 && (
        <Section
          title="Ligands and ions"
          count={stats.ligands.length}
          storageKey={`${FOLD}ligands`}
          summary={stats.ligands
            .slice(0, 4)
            .map(([comp]) => comp)
            .join(" ")}
        >
          <div className="flex flex-wrap gap-1">
            {stats.ligands.map(([comp, n]) => (
              <span key={comp} className="hs-tag">
                {comp}
                {n > 1 && <span className="hs-unit">x{n}</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {cat?.details && (
        <Section title="Notes" defaultOpen={false} storageKey={`${FOLD}notes`}>
          <div className="text-[10.5px] leading-snug text-ink-secondary">{cat.details}</div>
        </Section>
      )}

      <Section title="Files" count={provenance.length || undefined} defaultOpen={false} storageKey={`${FOLD}files`}>
        <div className="flex flex-col gap-2">
          {provenance.map((p, i) => (
            <FileRow key={i} p={p} />
          ))}
          <TinyText>
            {entry.source === "dpdb" ? "Dynamic PDB catalogue entry" : "RCSB example entry"}; facts from the deposited mmCIF header
            {entry.source === "dpdb" ? " and the catalogue" : ""}.
          </TinyText>
        </div>
      </Section>
    </div>
  );
}
