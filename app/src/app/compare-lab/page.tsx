"use client";
import dynamic from "next/dynamic";

// Two models against one map, metrics projected into density, dedicated slice viewer.
// See src/components/lab/CompareLabPanel.tsx and docs/roadmap.md.
const CompareLabPanel = dynamic(() => import("@/components/lab/CompareLabPanel"), { ssr: false });

export default function Page() {
  return <CompareLabPanel />;
}
