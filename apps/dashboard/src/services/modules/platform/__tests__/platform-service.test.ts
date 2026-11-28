import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
const mockDownloadBlob = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: mockDelete,
      downloadBlob: mockDownloadBlob,
      refresh: jest.fn(),
    })),
  };
});

const ID = "6f1d3c2b-8a4e-4f5d-9c7b-1a2b3c4d5e6f";
const KEY = { idempotencyKey: "key-1" };

async function service() {
  return import("../platform-service");
}

describe("platform-service", () => {
  beforeEach(() => {
    jest.resetModules();
    [mockGet, mockPost, mockPatch, mockDelete, mockDownloadBlob].forEach((mock) => {
      mock.mockReset();
    });
    mockGet.mockResolvedValue({ data: [], meta: {} });
    mockPost.mockResolvedValue({ data: {} });
    mockPatch.mockResolvedValue({ data: {} });
  });

  it("lists tenants with the status and plan filters the API names", async () => {
    const { fetchTenantPage } = await service();

    await fetchTenantPage({
      page: 2,
      pageSize: 25,
      search: "city",
      status: "trial",
      currentPlan: "std",
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/platform/tenants",
      expect.objectContaining({
        query: expect.objectContaining({
          page: 2,
          search: "city",
          status: "trial",
          current_plan: "std",
        }) as unknown,
      }),
    );
  });

  it("posts each lifecycle action to its colon-action under the dialog's Idempotency-Key", async () => {
    const svc = await service();

    await svc.provisionTenant(ID, { plan_code: "std" }, KEY);
    await svc.suspendTenant(ID, { reason: "unpaid" }, KEY);
    await svc.reinstateTenant(ID, { reason: "" }, KEY);
    await svc.deleteTenant(ID, { reason: "closing", waive_export: true }, KEY);
    await svc.restoreTenant(ID, { reason: "mistake" }, KEY);

    ["provision", "suspend", "reinstate", "delete", "restore"].forEach((action, index) => {
      expect(mockPost).toHaveBeenNthCalledWith(
        index + 1,
        `/platform/tenants/${ID}:${action}`,
        expect.anything(),
        KEY,
      );
    });
  });

  it("starts an export, polls its job, and mints a download link with :download", async () => {
    const { downloadTenantExport, exportTenant, fetchTenantJob } = await service();
    mockPost.mockResolvedValueOnce({ data: { job_id: "job-1", status: "queued" } });
    mockGet.mockResolvedValue({ data: { id: "job-1", status: "succeeded" } });
    mockPost.mockResolvedValueOnce({
      data: { download_url: "https://storage.test/export.zip", expires_in: 300 },
    });

    await expect(exportTenant(ID, KEY)).resolves.toEqual({ job_id: "job-1", status: "queued" });
    await fetchTenantJob(ID, "job-1");
    await expect(downloadTenantExport(ID, "job-1")).resolves.toEqual({
      download_url: "https://storage.test/export.zip",
      expires_in: 300,
    });

    expect(mockPost).toHaveBeenNthCalledWith(1, `/platform/tenants/${ID}:export`, undefined, KEY);
    expect(mockGet).toHaveBeenCalledWith(`/platform/tenants/${ID}/jobs/job-1`);
    expect(mockPost).toHaveBeenNthCalledWith(2, `/platform/tenants/${ID}/jobs/job-1:download`);
  });

  it("refreshes usage with :refresh-usage, and reads it from /usage", async () => {
    const { fetchTenantUsage, refreshTenantUsage } = await service();

    await fetchTenantUsage(ID);
    await refreshTenantUsage(ID);

    expect(mockGet).toHaveBeenCalledWith(`/platform/tenants/${ID}/usage`);
    expect(mockPost).toHaveBeenCalledWith(`/platform/tenants/${ID}:refresh-usage`);
  });

  it("posts the subscription actions to their colon-actions", async () => {
    const svc = await service();
    const period = {
      current_period_start: "2026-12-01T00:00:00Z",
      current_period_end: "2027-01-01T00:00:00Z",
    };

    await svc.activateSubscription(
      ID,
      { plan_code: "std", ...period, acknowledge_over_usage: false },
      KEY,
    );
    await svc.recordPayment(ID, { paid_through: "2027-02-01T00:00:00Z" }, KEY);
    await svc.markPaymentFailed(ID, KEY);
    await svc.changePlan(ID, { plan_code: "pro", acknowledge_over_usage: true }, KEY);

    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      `/platform/tenants/${ID}/subscription:activate`,
      { plan_code: "std", ...period, acknowledge_over_usage: false },
      KEY,
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      2,
      `/platform/tenants/${ID}/subscription:record-payment`,
      { paid_through: "2027-02-01T00:00:00Z" },
      KEY,
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      3,
      `/platform/tenants/${ID}/subscription:mark-payment-failed`,
      undefined,
      KEY,
    );
    expect(mockPost).toHaveBeenNthCalledWith(
      4,
      `/platform/tenants/${ID}/subscription:change-plan`,
      { plan_code: "pro", acknowledge_over_usage: true },
      KEY,
    );
  });

  it("manages a school's overrides under its tenant", async () => {
    const svc = await service();

    await svc.fetchOverrides(ID);
    await svc.createOverride(ID, { flag: "module.fees", enabled: true, reason: "pilot" });
    await svc.deleteOverride(ID, "ov-1");

    expect(mockGet).toHaveBeenCalledWith(`/platform/tenants/${ID}/feature-overrides`);
    expect(mockPost).toHaveBeenCalledWith(`/platform/tenants/${ID}/feature-overrides`, {
      flag: "module.fees",
      enabled: true,
      reason: "pilot",
    });
    expect(mockDelete).toHaveBeenCalledWith(`/platform/tenants/${ID}/feature-overrides/ov-1`);
  });

  it("reads every page of the plans and flags a picker offers, not only the first", async () => {
    const { fetchActivePlans, fetchAllFlags } = await service();
    const page = (n: number, item: string) => ({
      data: [{ id: item }],
      meta: { pagination: { page: n, page_size: 100, total_count: 2, total_pages: 2 } },
    });
    mockGet
      .mockResolvedValueOnce(page(1, "p1"))
      .mockResolvedValueOnce(page(2, "p2"))
      .mockResolvedValueOnce(page(1, "f1"))
      .mockResolvedValueOnce(page(2, "f2"));

    await expect(fetchActivePlans()).resolves.toEqual([{ id: "p1" }, { id: "p2" }]);
    await expect(fetchAllFlags()).resolves.toEqual([{ id: "f1" }, { id: "f2" }]);
  });

  it("lists active plans for a picker and patches, retires and creates plans", async () => {
    const svc = await service();

    await svc.fetchActivePlans();
    await svc.updatePlan("p1", { name: "Pro" });
    await svc.retirePlan("p1");
    await svc.fetchPlanPage({ page: 1, isActive: false });

    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      "/platform/plans",
      expect.objectContaining({
        query: expect.objectContaining({ is_active: true, ordering: "name" }) as unknown,
      }),
    );
    expect(mockPatch).toHaveBeenCalledWith("/platform/plans/p1", { name: "Pro" });
    expect(mockDelete).toHaveBeenCalledWith("/platform/plans/p1");
    expect(mockGet).toHaveBeenLastCalledWith(
      "/platform/plans",
      expect.objectContaining({ query: expect.objectContaining({ is_active: false }) as unknown }),
    );
  });

  it("patches a flag, and reads every flag for a picker", async () => {
    const svc = await service();

    await svc.updateFlag("f1", { default_enabled: false });
    await svc.fetchAllFlags();

    expect(mockPatch).toHaveBeenCalledWith("/platform/feature-flags/f1", {
      default_enabled: false,
    });
    expect(mockGet).toHaveBeenCalledWith(
      "/platform/feature-flags",
      expect.objectContaining({ query: expect.objectContaining({ ordering: "key" }) as unknown }),
    );
  });

  it("reads a report as JSON, and downloads it as CSV", async () => {
    const { downloadReport, fetchReport } = await service();
    mockGet.mockResolvedValue({ data: { key: "revenue", sections: {} } });
    mockDownloadBlob.mockResolvedValue(new Blob(["a,b"]));

    await fetchReport("revenue");
    await downloadReport("revenue");

    expect(mockGet).toHaveBeenCalledWith("/platform/reports/revenue");
    expect(mockDownloadBlob).toHaveBeenCalledWith("/platform/reports/revenue", {
      query: { format: "csv" },
    });
  });
});
