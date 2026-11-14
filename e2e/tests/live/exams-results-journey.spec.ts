import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { buildProcessedExam, liveExamTimeout } from "@/lib/live-exams";
import { E2E_PRINCIPAL_EMAIL } from "@/lib/seed-constants";

/**
 * Live lane — requires the real stack, seeded (`seed_e2e_data`; see
 * `tests/live/tenant-isolation.spec.ts`'s header for the run command).
 *
 * examinations.md §5.6 as the approver meets it: the seeded principal signs in, opens
 * Examinations, then the exam, then Results, and approves and publishes results this spec took to
 * `processing` through the real API (`buildProcessedExam`: the exam staff entered, locked and
 * processed the marks, so the principal is not the processor). What only the browser proves: that
 * the screen offers Approve to an approver who did not run the processing, that the approval and
 * publication it sends are ones the server accepts, and that the list reads back what they wrote.
 * The refusal of the processor's own approval is the API lane's (`api/exams-results.spec.ts`).
 *
 * The student's view of published results stays in the Django suite (`ResultViewSet`'s
 * restricted-principal narrowing): parallel workers would race on the seeded student's single
 * active enrolment.
 *
 * Auth budget (`AuthEndpointThrottle`, e2e/AGENTS.md): **one** browser login and **no** refresh.
 * Every screen after the login is reached by a click (sidebar, the exam's link, the Results tab),
 * never `page.goto`. The worker-scoped `liveApiClient` and exam staff session that build the exam
 * add no login per test.
 *
 * Waits: the processing job is awaited over the API (up to `LIVE_JOB_TIMEOUT_MS`) before the
 * browser opens, after the scaffold and up to two worker logins, so the test's budget is
 * `liveExamTimeout(1)`, not the project's 30 s. Once the browser opens nothing polls: approving and
 * publishing are synchronous and each a list reload, so the default 5 s expect covers every
 * step (L6).
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("exam results approval (real API, principal)", () => {
  test("the principal approves and publishes an exam's processed results", async ({
    page,
    loginPage,
    dashboardPage,
    examsPage,
    examResultsPage,
    liveApiClient,
  }) => {
    // One polled job, plus the logins, the scaffold and the screens around it.
    test.setTimeout(liveExamTimeout(1));
    const { scaffold, exam } = await buildProcessedExam(liveApiClient);
    const count = scaffold.studentIds.length;

    // --- 1. Sign in and reach the exam through the sidebar and the list. ---
    await loginPage.goto();
    await loginPage.signIn({ identifier: E2E_PRINCIPAL_EMAIL, password: env.LIVE_ADMIN_PASSWORD });
    await expect(page).toHaveURL("/dashboard");
    // The permission-gated nav renders only after the dashboard's own data loads.
    await expect(dashboardPage.heading).toBeVisible();
    await dashboardPage.navGroup("Examinations").click();
    await dashboardPage.navLink("Exams").click();
    await examsPage.search.fill(exam.examName);
    // The search writes the URL after a debounce; clicking first lets that late write pull the
    // page back to the list, so wait for the filter to land as a person waits for the results.
    await expect(page).toHaveURL(/[?&]search=/);
    await examsPage.examLink(exam.examName).click();
    await examResultsPage.tab("Results").click();

    // --- 2. Processed by someone else, so Approve is offered. ---
    await expect(examResultsPage.table.getByText("Awaiting approval", { exact: true })).toHaveCount(
      count,
    );
    await expect(examResultsPage.approveButton).toBeEnabled();
    await expect(examResultsPage.ownRunNote).toHaveCount(0);

    // --- 3. Approve, then publish. ---
    await examResultsPage.approveButton.click();
    await examResultsPage.confirm("Approve results").click();
    await expect(page.getByText(`${String(count)} results approved.`)).toBeVisible();
    await expect(examResultsPage.table.getByText("Approved", { exact: true })).toHaveCount(count);

    await examResultsPage.publishButton.click();
    await examResultsPage.confirm("Publish results").click();
    await expect(
      page.getByText(`${String(count)} results published; none withheld.`),
    ).toBeVisible();
    await expect(examResultsPage.table.getByText("Published", { exact: true })).toHaveCount(count);
    await expect(examResultsPage.approveButton).toHaveCount(0);
  });
});
