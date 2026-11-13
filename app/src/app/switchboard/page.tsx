"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Prototype page for the Models Switchboard: the viewer on one real Dynamic PDB deposition,
// opened with a box for every model it has. `?entry=dpdb_...` picks the deposition,
// `?model=<model id>` the model the main view holds, `?boxes=primary` starts with that
// model's box alone.
const HetstarViewer = dynamic(() => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer), { ssr: false });

/** 4N0X: deposited, re-refined, ensemble-refinement and qFit models */
const DEFAULT_ENTRY = "dpdb_llq1s674";

export default function SwitchboardPage() {
  const [target, setTarget] = useState<{ entry: string; model: string | null; boxes: "primary" | "all" } | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setTarget({
      entry: query.get("entry") ?? DEFAULT_ENTRY,
      model: query.get("model"),
      boxes: query.get("boxes") === "primary" ? "primary" : "all",
    });
  }, []);
  if (!target) return null;
  return (
    <main style={{ height: "100vh" }}>
      <HetstarViewer entryId={target.entry} modelId={target.model} switchboard={{ boxes: target.boxes, maxBoxes: 6 }} />
    </main>
  );
}
