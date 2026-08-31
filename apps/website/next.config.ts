import path from "node:path";

import type { NextConfig } from "next";

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
     * Next 16 type-checks builds via the project-local `tsc` CLI; our `typescript` dependency
     * is the TS 6 API alias (it ships `tsc6`, not `tsc`) because typescript-eslint and
     * eslint-config-next need that API — see the root AGENTS.md. Use the JavaScript compiler
     * API instead, which TS 6 provides. TypeScript 7 still checks the project through the
     * required `pnpm typecheck` job.
     */
    useTypeScriptCli: false,
  },
  transpilePackages: ["@schoolhub/ui", "@schoolhub/types"],
  poweredByHeader: false,
  images: {
    // Tenant media lives in tenant-prefixed object storage behind the CDN.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
