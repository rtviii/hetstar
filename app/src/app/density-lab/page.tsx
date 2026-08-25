"use client";
import dynamic from "next/dynamic";

// The incremental density prototyping page. See src/components/lab/DensityLabPanel.tsx.
const DensityLabPanel = dynamic(() => import("@/components/lab/DensityLabPanel"), { ssr: false });

export default function Page() {
  return <DensityLabPanel />;
}
