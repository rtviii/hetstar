"use client";
import dynamic from "next/dynamic";

// Hidden spike route (not linked from the NavBar): density capabilities against the
// 7A1X qFit multiconformer sample. See app/src/lib/molstar/density.ts.
const DensitySpikePanel = dynamic(() => import("@/components/spike/DensitySpikePanel"), { ssr: false });

export default function Page() {
  return <DensitySpikePanel />;
}
