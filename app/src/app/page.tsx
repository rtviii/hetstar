"use client";
import dynamic from "next/dynamic";

// The viewer as dynamicpdb.com mounts it: no preset prop, so the dynamicpdb card look and no
// module, opened on one entry. Mol* needs the browser, so no SSR. The hetcif preset has a
// page of its own at /hetcif.
const HetstarViewer = dynamic(() => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer), { ssr: false });

export default function Page() {
  return (
    <main style={{ height: "100vh" }}>
      <HetstarViewer entryId="7APT" />
    </main>
  );
}
