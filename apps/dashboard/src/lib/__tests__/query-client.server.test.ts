/**
 * @jest-environment node
 *
 * `getQueryClient`'s server branch (`typeof window === "undefined"`) only exists in a
 * real server environment — jsdom always defines `window` (non-configurable, so it
 * cannot be deleted from a jsdom test to simulate SSR). This file runs under Jest's
 * `node` environment instead, where `window` genuinely does not exist, to exercise that
 * branch for real rather than mocking it out.
 */
import { getQueryClient } from "../query-client";

describe("getQueryClient on the server", () => {
  it("creates a fresh client per call, never a shared singleton", () => {
    expect(typeof window).toBe("undefined");

    const first = getQueryClient();
    const second = getQueryClient();

    // A module-level singleton on the server would leak one tenant's cached data into
    // another tenant's request (see the function's own docstring).
    expect(first).not.toBe(second);
  });
});
