import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
