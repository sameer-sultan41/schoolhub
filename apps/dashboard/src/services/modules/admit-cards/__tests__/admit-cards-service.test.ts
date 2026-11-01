import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("admit-cards-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads one cursor page of an exam's cards, filtered by section and status", async () => {
    const { fetchAdmitCardsPage } = await import("../admit-cards-service");
    mockGet.mockResolvedValue({
      data: [{ id: "c1" }],
      meta: { pagination: { next_cursor: "n2", has_more: true } },
    });

    const page = await fetchAdmitCardsPage({
      examId: "e1",
      pageSize: 25,
      cursor: "n1",
      sectionId: "s1",
      status: "issued",
    });

    expect(page.items).toEqual([{ id: "c1" }]);
    expect(mockGet).toHaveBeenCalledWith(
      "/admit-cards",
      expect.objectContaining({
        query: expect.objectContaining({
          exam_id: "e1",
          page_size: 25,
          cursor: "n1",
          section_id: "s1",
          status: "issued",
        }),
      }),
    );
  });

  it("issues with the Idempotency-Key, returning the job and the server's counts", async () => {
    const { issueAdmitCards } = await import("../admit-cards-service");
    mockPost.mockResolvedValue({
      data: { job_id: "j1", status: "queued", added: 2, existing: 1 },
      meta: { message: "Admit cards queued for rendering." },
    });

    await expect(issueAdmitCards("e1", "key-1")).resolves.toEqual({
      jobId: "j1",
      added: 2,
      existing: 1,
    });
    expect(mockPost).toHaveBeenCalledWith("/exams/e1:issue-admit-cards", undefined, {
      idempotencyKey: "key-1",
    });
  });

  it("revokes with the reason in the body", async () => {
    const { revokeAdmitCard } = await import("../admit-cards-service");
    mockPost.mockResolvedValue({ data: { id: "c1", status: "revoked" } });

    await expect(revokeAdmitCard("c1", "Fees outstanding")).resolves.toEqual({
      id: "c1",
      status: "revoked",
    });
    expect(mockPost).toHaveBeenCalledWith("/admit-cards/c1:revoke", {
      reason: "Fees outstanding",
    });
  });

  it("asks the card's own download action for its link", async () => {
    const { fetchAdmitCardDownloadUrl } = await import("../admit-cards-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.test/c1.pdf" } });

    await expect(fetchAdmitCardDownloadUrl("c1")).resolves.toBe("https://files.test/c1.pdf");
    expect(mockPost).toHaveBeenCalledWith("/admit-cards/c1:download");
  });
});
