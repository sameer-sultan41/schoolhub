import { fail, ok, type MockResponse } from "../envelope";
import { cursorPageOf } from "../list";
import type { MockModule } from "../router";
import { colonAction } from "./attendance-mock-utils";
import type { PortalStore } from "./portal-store";

/** `NotFound`'s sentence, as the envelope handler sends it. */
const NOT_FOUND = "Not found.";

/** `ActionResponse.ok`'s sentence for `:acknowledge`. */
const ACKNOWLEDGED = "Acknowledged.";

/** What a streamed receipt carries in the stub: a PDF header is all the download needs. */
const PDF_BODY = "%PDF-1.4 e2e receipt";
/** `assert_preference_may_be_saved`'s refusal, word for word. */
const EMERGENCY_LOCKED = "The emergency notification category cannot be disabled.";

/** `InvoiceFilter.outstanding`: issued, partially paid or overdue, none of them settled. */
const OUTSTANDING_STATUSES: readonly string[] = ["issued", "partially_paid", "overdue"];

/** `?flag=true|false` as the API reads a boolean query value. */
function flag(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * A guardian's portal reads and writes, for the family in `store`:
 * `GET /parent-portal/dashboard`; the child's `/student-attendance`, `/fee-invoices`,
 * `/receipts` (and the streamed `/receipts/{id}/download`) and `/results`; `/notices` with
 * `:acknowledge`; the inbox `/notifications` with `:unread-count`, `:mark-read` and
 * `:mark-all-read`; and `/notification-preferences`.
 *
 * Lists are cursor paged and honour the filters the dashboard sends. The stub serves exactly
 * what it was seeded with: which rows a guardian may see is the backend suite's job, so nothing
 * here re-derives scope. The router reads `:name` as a parameter, so a colon action's path
 * compiles to `/notifications([^/]+)` and its handler strips the colon.
 */
export function portalModule(store: PortalStore): MockModule {
  return (api) => {
    api.get("/parent-portal/dashboard", () => ok(store.dashboard()));

    // ---- a child's pages ---------------------------------------------------------------
    api.get("/student-attendance", (request) => {
      const studentId = request.searchParams.get("student_id");
      const from = request.searchParams.get("date__gte");
      const to = request.searchParams.get("date__lte");
      const rows = store.attendance
        .filter((row) => !studentId || row.student_id === studentId)
        .filter((row) => !from || row.attendance_date >= from)
        .filter((row) => !to || row.attendance_date <= to)
        .sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/fee-invoices", (request) => {
      const studentId = request.searchParams.get("student");
      const status = request.searchParams.get("status");
      const outstanding = flag(request.searchParams.get("outstanding"));
      const rows = store.invoices
        .filter((row) => !studentId || row.student === studentId)
        .filter((row) => !status || row.status === status)
        .filter((row) => outstanding === undefined || OUTSTANDING_STATUSES.includes(row.status));
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/fee-invoices/:invoiceId", (request) => {
      const invoice = store.invoices.find((row) => row.id === request.params["invoiceId"]);
      return invoice ? ok(invoice) : fail(404, NOT_FOUND);
    });

    // Tenant-wide, as the real list is until `/receipts` can filter by student.
    api.get("/receipts", (request) => cursorPageOf(store.receipts, request.searchParams));

    api.get("/receipts/:receiptId/download", (request): MockResponse => {
      if (!store.receipts.some((row) => row.id === request.params["receiptId"])) {
        return fail(404, NOT_FOUND);
      }
      // Like the real API, refuse an anonymous request. The dashboard keeps its token in memory
      // and only gets one through a 401 and a refresh, which a stub that always answers 200 never
      // provokes, so the client's own 401, refresh and replay runs here. The header each attempt
      // carried is recorded for the spec.
      const authorization = request.headers["authorization"];
      store.downloadAuthorizations.push(authorization);
      if (!authorization || !/^Bearer \S+/.test(authorization)) {
        return fail(401, "Authentication credentials were not provided.");
      }
      return { status: 200, body: PDF_BODY, headers: { "content-type": "application/pdf" } };
    });

    api.get("/results", (request) => {
      const studentId = request.searchParams.get("student_id");
      const rows = store.results
        .filter((row) => !studentId || row.student_id === studentId)
        .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
      return cursorPageOf(rows, request.searchParams);
    });

    // ---- notices -----------------------------------------------------------------------
    api.get("/notices", (request) => {
      const rows = [...store.notices].sort((a, b) =>
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
      );
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/notices/:noticeId", (request) => {
      const notice = store.notices.find((row) => row.id === request.params["noticeId"]);
      return notice ? ok(notice) : fail(404, NOT_FOUND);
    });

    api.post("/notices/:noticeAction", (request) => {
      const { id, action } = colonAction(request.params["noticeAction"]);
      if (action !== "acknowledge" || !store.acknowledge(id)) return fail(404, NOT_FOUND);
      return ok({}, { meta: { message: ACKNOWLEDGED } });
    });

    // ---- the inbox ---------------------------------------------------------------------
    api.get("/notifications", (request) => {
      const read = flag(request.searchParams.get("read"));
      const rows = store.notifications
        .filter((row) => read === undefined || (row.read_at !== null) === read)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return cursorPageOf(rows, request.searchParams);
    });

    api.get("/notifications:action", (request) => {
      const action = (request.params["action"] ?? "").replace(/^:/, "");
      if (action !== "unread-count") return fail(404, NOT_FOUND);
      return ok({ unread: store.unreadCount() });
    });

    api.post("/notifications:action", (request) => {
      const action = (request.params["action"] ?? "").replace(/^:/, "");
      if (action !== "mark-all-read") return fail(404, NOT_FOUND);
      const body = request.json() as { before?: string } | null;
      return ok({ marked: store.markAllRead(body?.before) });
    });

    api.post("/notifications/:notificationAction", (request) => {
      const { id, action } = colonAction(request.params["notificationAction"]);
      if (action !== "mark-read") return fail(404, NOT_FOUND);
      const readAt = store.markRead(id);
      return readAt === undefined ? fail(404, NOT_FOUND) : ok({ read_at: readAt });
    });

    // ---- preferences -------------------------------------------------------------------
    api.get("/notification-preferences", () => ok(store.preferences));

    api.patch("/notification-preferences", (request) => {
      const body = request.json() as
        { event_category: string; channel: string; is_enabled: boolean }[] | null;
      // The server's emergency floor (`preferences/services/save.py`): the whole save is refused.
      if ((body ?? []).some((c) => c.event_category === "emergency" && !c.is_enabled)) {
        return fail(422, EMERGENCY_LOCKED, { code: "domain_rule_violation" });
      }
      for (const change of body ?? []) {
        store.setPreference(change.event_category, change.channel, change.is_enabled);
      }
      return ok(store.preferences);
    });
  };
}
