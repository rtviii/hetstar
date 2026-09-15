"use client";
import dynamic from "next/dynamic";

// The whole app is the viewer, opened on one catalogue entry. Mol* needs the browser, so no SSR.
const HetstarViewer = dynamic(() => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer), { ssr: false });

export default function Page() {
  return (
    <main style={{ height: "100vh" }}>
      <HetstarViewer entryId="7APT" />
    </main>
  );
}
