// Server-only: forwards one upstream GET and streams the body back. Used by the two dev
// proxy routes under app/api so a local origin can reach dynamicpdb.com and
// files.dynamicpdb.com (neither sends CORS headers for us). Delete together with the routes
// once hetstar lives on dynamicpdb.com.

export async function proxyUpstream(url: string): Promise<Response> {
  const up = await fetch(url, { redirect: "follow", cache: "no-store" });
  // Node's fetch already decoded any gzip, so content-length / content-encoding must not be
  // forwarded; content-type is the only header the client needs.
  const headers = new Headers({ "cache-control": "no-store" });
  const ct = up.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  return new Response(up.body, { status: up.status, headers });
}
