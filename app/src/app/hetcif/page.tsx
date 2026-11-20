"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { hetcifPreset } from "@dynamic-pdb/hetstar/hetcif";

// The hetcif workbench: the viewer under the hetcif preset (ball-and-stick, letter colours,
// the hetcif module and its example files from app/public/hetcif/). `?entry=<id>` opens
// another example; the default is the smallest carved one.
const HetstarViewer = dynamic(() => import("@dynamic-pdb/hetstar").then((m) => m.HetstarViewer), { ssr: false });

const DEFAULT_ENTRY = "7A1X-ARG102";

export default function HetcifPage() {
  const [entry, setEntry] = useState<string | null>(null);
  useEffect(() => {
    setEntry(new URLSearchParams(window.location.search).get("entry") ?? DEFAULT_ENTRY);
  }, []);
  if (!entry) return null;
  return (
    <main style={{ height: "100vh" }}>
      <HetstarViewer entryId={entry} preset={hetcifPreset} />
    </main>
  );
}
