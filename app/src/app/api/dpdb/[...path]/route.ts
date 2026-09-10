// Dev proxy for the Dynamic PDB catalogue: /api/dpdb/<path> -> https://dynamicpdb.com/api/v1/<path>

import { proxyUpstream } from "@/lib/dpdb/proxy";

export const dynamic = "force-dynamic";

const UPSTREAM = "https://dynamicpdb.com/api/v1";

export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  if (params.path.some((s) => s === "" || s === "..")) return new Response("bad path", { status: 400 });
  const search = new URL(req.url).search;
  return proxyUpstream(`${UPSTREAM}/${params.path.map(encodeURIComponent).join("/")}${search}`);
}
