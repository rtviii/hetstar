"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { ENTRIES, dynamicpdbPreset, hetcifPreset, type HetstarPreset } from "@dynamic-pdb/hetstar";

// The whole app is the viewer, opened on one entry. Mol* needs the browser, so no SSR.
// `?preset=hetcif` opens with the hetcif look (ball-and-stick, letter colours) on the
// smallest carved example; the default is the dynamicpdb card look on 7APT. The dev app
// lists every example in either preset, so both dropdown groups are reachable.
const HetstarViewer = dynamic(() => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer), { ssr: false });

export default function Page() {
  const [which, setWhich] = useState<"dynamicpdb" | "hetcif">("dynamicpdb");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("preset") === "hetcif") setWhich("hetcif");
  }, []);
  const preset = useMemo<HetstarPreset>(() => ({ ...(which === "hetcif" ? hetcifPreset : dynamicpdbPreset), entries: ENTRIES }), [which]);
  return (
    <main style={{ height: "100vh" }}>
      <HetstarViewer key={which} entryId={which === "hetcif" ? "7A1X-ARG102" : "7APT"} preset={preset} />
    </main>
  );
}
