import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";
import { Services } from "@/services";

/**
 * The real `Services` aggregate — every domain's call sites mock `@/services` to isolate
 * themselves, so this is the one place the real wiring (this file, plus each
 * `modules/<domain>/index.ts`) is proven correct: every action a call site names actually
 * resolves to a function, through the real barrels, not a typo one mock away from being
 * invisible.
 *
 * `@schoolhub/api-client` is still mocked, same reason every service test mocks it:
 * `@/lib/auth` builds a real `ApiClient` at module scope (`createApiClient(...)`), which
 * binds `globalThis.fetch` — absent under jsdom — so importing it unmocked crashes before
 * any of this file's own assertions run.
 */
jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    })),
    refreshAccessToken: jest.fn(),
  };
});

describe("Services", () => {
  it("aggregates every domain, each action a real function", () => {
    expect(Object.keys(Services).sort()).toEqual(["auth", "dashboard", "files", "tenant"]);

    expect(typeof Services.auth.login).toBe("function");
    expect(typeof Services.auth.logout).toBe("function");
    expect(typeof Services.auth.fetchCurrentUser).toBe("function");
    expect(typeof Services.auth.restoreSession).toBe("function");

    expect(typeof Services.tenant.fetchCurrentTenant).toBe("function");

    expect(typeof Services.dashboard.fetchDashboardOverview).toBe("function");
    expect(typeof Services.dashboard.fetchStaffPage).toBe("function");
    expect(typeof Services.dashboard.createStaff).toBe("function");

    expect(typeof Services.files.uploadFile).toBe("function");
  });
});
