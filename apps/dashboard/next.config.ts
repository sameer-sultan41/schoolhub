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
  transpilePackages: ["@schoolhub/ui", "@schoolhub/api-client", "@schoolhub/types"],
  poweredByHeader: false,
  images: {
    // Tenant logos and uploads come from the platform's object storage / CDN.
    remotePatterns: [{ protocol: "https", hostname: "**.schoolhub.cdn" }],
  },
  async headers() {
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
