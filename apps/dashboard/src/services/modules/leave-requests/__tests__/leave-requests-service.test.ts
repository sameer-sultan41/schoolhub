import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

import {
  LEAVE_ID,
  leavePage,
  leaveRecord,
  leaveType,
  SICK_TYPE_ID,
} from "./leave-requests-fixtures";

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

describe("leave-requests-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("pages the leave requests by cursor with its filters", async () => {
    const { fetchLeavePage } = await import("../leave-requests-service");
    const page = leavePage([leaveRecord()], { next: "n2" });
    mockGet.mockResolvedValue({ data: page.items, meta: { pagination: page.pagination } });

    const result = await fetchLeavePage({
      cursor: "c1",
      pageSize: 25,
      ordering: "-created_at",
      status: "pending",
      leaveTypeId: SICK_TYPE_ID,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });

    expect(result.items).toEqual([leaveRecord()]);
    expect(result.pagination).toMatchObject({ next_cursor: "n2" });
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/leave-requests");
    expect(options.query).toMatchObject({
      cursor: "c1",
      page_size: 25,
      ordering: "-created_at",
      status: "pending",
      leave_type_id: SICK_TYPE_ID,
      date__gte: "2026-10-01",
      date__lte: "2026-10-31",
    });
  });

  it("reads the leave types by name, in one full page", async () => {
    const { fetchLeaveTypes } = await import("../leave-requests-service");
    mockGet.mockResolvedValue({ data: [leaveType()], meta: {} });

    const types = await fetchLeaveTypes();

    expect(types).toEqual([leaveType()]);
    const [path, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(path).toBe("/leave-types");
    expect(options.query).toMatchObject({ ordering: "name", page_size: 100 });
  });

  it.each(["approve", "reject"] as const)(
    "posts %s on the colon-action with the note",
    async (action) => {
      const { decideLeave } = await import("../leave-requests-service");
      mockPost.mockResolvedValue({
        data: leaveRecord({ status: "approved" }),
        meta: { auto_marked_days: 3 },
      });

      const decided = await decideLeave(LEAVE_ID, action, "Seen the medical note");

      expect(mockPost).toHaveBeenCalledWith(`/leave-requests/${LEAVE_ID}:${action}`, {
        note: "Seen the medical note",
      });
      expect(decided.request.status).toBe("approved");
      expect(decided.autoMarkedDays).toBe(3);
    },
  );

  it("posts an empty body without a note, and reads no count the server did not send", async () => {
    const { decideLeave } = await import("../leave-requests-service");
    mockPost.mockResolvedValue({ data: leaveRecord({ status: "rejected" }), meta: undefined });

    const decided = await decideLeave(LEAVE_ID, "reject");

    expect(mockPost).toHaveBeenCalledWith(`/leave-requests/${LEAVE_ID}:reject`, {});
    expect(decided.autoMarkedDays).toBeNull();
  });
});
