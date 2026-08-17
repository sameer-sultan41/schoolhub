import { NextResponse } from "next/server";

/**
 * Liveness probe for the platform's uptime checks and container health checks.
 * Exempt from the auth middleware; deliberately exposes nothing tenant-specific.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      data: {
        status: "ok",
        app: "dashboard",
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
        time: new Date().toISOString(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
