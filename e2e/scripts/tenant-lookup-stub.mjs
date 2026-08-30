#!/usr/bin/env node
// Minimal HTTP server standing in for the API, for the one call the website's SSR layer
// makes that MockApi (browser interception) cannot see.
//
// apps/website/src/app/layout.tsx — the ROOT layout, wrapping every page route including
// "/" and "/platform-landing" — unconditionally calls resolveTenant(), a server-side
// `fetch()` in `apps/website/src/lib/api.ts`. That request runs on the Node server, never
// in the browser, so `page.route()` (what MockApi uses) cannot intercept it. There is no
// page-rendering route that skips this call, which is what made every mocked `website`
// test fail with ECONNREFUSED once the readiness probe stopped hiding it. (Metadata routes
// — robots.ts, sitemap.ts — are not wrapped by the layout and never hit this.)
//
// Scope: every host in the mocked project resolves to "unknown" (404 → readJson returns
// null). No mocked website spec asserts on a known tenant's rendered content — that needs
// the live lane, where a real API answers with real data.
import { createServer } from "node:http";

const port = Number(new URL(process.env.API_BASE_URL ?? "http://127.0.0.1:4010").port || 80);

const notFound = JSON.stringify({
  error: { code: "not_found", message: "Not found.", request_id: "e2e-tenant-stub" },
});

createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404, { "content-type": "application/json" }).end(notFound);
}).listen(port, "127.0.0.1", () => {
  // console.log is disallowed by the shared ESLint config (warn/error only); this is
  // startup diagnostics, not application logging, so it goes to stderr via console.error.
  console.error(`[tenant-lookup-stub] listening on 127.0.0.1:${port}`);
});
