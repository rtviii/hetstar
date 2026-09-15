// Dev proxy for catalogue artifacts on hosts that send no CORS headers:
// /api/dpdb-file?u=<encoded https uri>. Redirects (the /api/v1/files shortcut) are followed
// server-side so the browser never touches files.dynamicpdb.com itself.

import { proxyUpstream } from "@/lib/dpdb-proxy";

export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = new Set(["files.dynamicpdb.com", "dynamicpdb.com"]);

export async function GET(req: Request) {
  let target: URL;
  try {
    target = new URL(new URL(req.url).searchParams.get("u") ?? "");
  } catch {
    return new Response("missing or invalid u", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.host)) {
    return new Response("host not allowed", { status: 403 });
  }
  return proxyUpstream(target.toString());
}
