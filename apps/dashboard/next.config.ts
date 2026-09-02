import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Emits .next/standalone with only the files the server actually needs, which is
   * what the Dockerfile copies (nextjs.org/docs/app/getting-started/deploying).
   * outputFileTracingRoot points at the workspace root so tracing follows imports
   * into packages/* rather than stopping at this app.
   */
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  /**
   * pnpm stores `next`'s own dependencies in the virtual store and symlinks them into
   * `next/node_modules/`. The file tracer copies the symlink but not its target, so the
   * standalone server dies at boot with `Cannot find module '@swc/helpers/esm/…'`.
   * Tracing the real directory in fixes it. Found by the E2E suite, which runs the
   * standalone output the same way the Dockerfile's CMD does.
   */
  outputFileTracingIncludes: {
    "/*": ["../../node_modules/.pnpm/@swc+helpers*/node_modules/@swc/helpers/**/*"],
  },
  experimental: {
    /**
     * Next 16 type-checks builds by shelling out to the project-local `tsc` CLI. Our
     * `typescript` dependency is the TS 6 API alias (`@typescript/typescript6`, which ships
     * `tsc6`, not `tsc`) because typescript-eslint and eslint-config-next require that API —
     * see the root AGENTS.md. So point Next at the JavaScript compiler API instead, which the
     * TS 6 package does provide.
     *
     * TypeScript 7 still checks this project: `pnpm typecheck` runs the native `tsc` from
     * `@typescript/native`, and it is a required CI check.
     */
    useTypeScriptCli: false,
  },
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  // next-intl's whole dependency chain is here too — none of these are in Next's own
  // default-transpiled list, and `next/jest` derives its Jest transformIgnorePatterns
  // from this array. Every package below ships ESM-only (`"type": "module"`, no CJS
  // entry), so without all of them, any test that renders a component using next-intl
  // fails with "Jest encountered an unexpected token" the moment `useTranslations`
  // pulls one in for message formatting (dev/build already handle it fine via
  // webpack/Turbopack, which resolve ESM directly and don't need this list at all).
  transpilePackages: [
    "@schoolhub/ui",
    "@schoolhub/api-client",
    "@schoolhub/types",
    "next-intl",
    "use-intl",
    "@formatjs/fast-memoize",
    "@formatjs/icu-messageformat-parser",
    "@formatjs/icu-skeleton-parser",
    "intl-messageformat",
    "icu-minify",
    "@schummar/icu-type-parser",
  ],
  poweredByHeader: false,
  /**
   * The cookie-bearing auth endpoints (login, refresh, logout) are proxied through this
   * server rather than called cross-origin from the browser. A tenant subdomain
   * (<slug>.<platform-domain>) and this API's own fixed host are, in local dev,
   * DIFFERENT "sites" for SameSite purposes — "localhost" has no further public-suffix
   * structure, so browsers treat it as its own effective TLD (the same rule behind the
   * Domain=.localhost rejection noted in apps/api/core/rbac/views.py), making
   * demo.localhost and localhost different registrable sites even though they share the
   * label "localhost". A SameSite=Lax refresh cookie set on one is never sent back on a
   * fetch to the other, so session restore/rotation would silently fail on any page
   * reload past the 15-minute access-token lifetime. Routing through this same-origin
   * proxy sidesteps SameSite entirely — the browser only ever talks to its own origin.
   */
  rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL}/auth/:path*`,
      },
    ];
  },
  // Next blocks HMR/dev-asset requests from an origin other than the one the dev server
  // detected unless allowlisted — tenant dashboard subdomains (<slug>.app.localhost:3000,
  // see src/lib/host.ts) are a different origin per tenant. Both entries are listed
  // explicitly rather than relying on "*.localhost" to also cover the two-label case.
  // Dev-only; production builds don't run this dev server.
  allowedDevOrigins: ["*.localhost", "*.app.localhost"],
  images: {
    // Tenant logos and uploads come from the platform's object storage / CDN.
    remotePatterns: [{ protocol: "https", hostname: "**.schoolhub.cdn" }],
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
