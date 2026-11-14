import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";
import type { PermissionKey } from "@schoolhub/types";

import { PaymentsHome } from "@/features/fees/payments/payments-home";
import {
  asUser,
  cursorPage,
  fetchJob,
  fetchSettlementImport,
  IMPORT_ID,
  importRecord,
  listSettlementImports,
  PAYMENTS_VIEW_PERMISSIONS,
  ruleViolation,
  stubFeesServices,
  uploadSettlementImport,
} from "./fees-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => object }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ feesServicesMock: () => unknown }>("./fees-services-mock")
    .feesServicesMock(),
);

const COLLECTOR: PermissionKey[] = [...PAYMENTS_VIEW_PERMISSIONS, "fees.payment.collect"];

function job(
  status: BackgroundJobRecord["status"],
  overrides: Partial<BackgroundJobRecord> = {},
): BackgroundJobRecord {
  return {
    id: "job-1",
    job_type: "fees.import-settlement-file",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result: status === "succeeded" ? { row_count: 4, matched: 3, exceptions: 1 } : null,
    error: null,
    ...overrides,
  };
}

async function renderImports(keys: PermissionKey[] = COLLECTOR, withRow = true) {
  stubFeesServices("/fees/payments?tab=imports");
  asUser(...keys);
  listSettlementImports.mockResolvedValue(cursorPage(withRow ? [importRecord()] : []));
  fetchSettlementImport.mockResolvedValue(importRecord());
  renderWithProviders(
    <>
      <UserLoaded />
      <PaymentsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup({ delay: null });
}

const FILE = new File(["consumer,amount\n1234567890,1350.00"], "settlement.csv", {
  type: "text/csv",
});

async function openUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Upload settlement file" }));
  return screen.findByRole("dialog", { name: "Upload settlement file" });
}

async function upload(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.upload(within(dialog).getByLabelText("Settlement file"), FILE);
  await user.click(within(dialog).getByRole("button", { name: "Upload" }));
}

describe("payments page: settlement imports", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("uploads the file with its provider, polls the job to done and shows its own counts", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    uploadSettlementImport.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValueOnce(job("running")).mockResolvedValue(job("succeeded"));
    const user = await renderImports();
    const reads = listSettlementImports.mock.calls.length;

    const dialog = await openUpload(user);
    await upload(user, dialog);

    expect(await within(dialog).findByText("Reconciling the file… 40%")).toBeInTheDocument();
    await jest.advanceTimersByTimeAsync(2000);
    expect(await within(dialog).findByText("3 of 4 rows matched and posted.")).toBeInTheDocument();
    expect(within(dialog).getByText(/1 row didn't post/)).toBeInTheDocument();
    expect(uploadSettlementImport).toHaveBeenCalledWith(
      FILE,
      "bank_branch",
      expect.stringMatching(/\S+/),
    );
    expect(fetchJob).toHaveBeenCalledWith("job-1");
    // The list reloads on acceptance and again when the job ends.
    await waitFor(() => {
      expect(listSettlementImports.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("shows the job's own sentence when the import fails", async () => {
    uploadSettlementImport.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue(job("failed", { result: null, error: "The file is not readable." }));
    const user = await renderImports();

    const dialog = await openUpload(user);
    await upload(user, dialog);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The file is not readable.");
  });

  it("reuses one Idempotency-Key when the same upload is retried after a failure", async () => {
    uploadSettlementImport.mockRejectedValueOnce(new Error("network down"));
    uploadSettlementImport.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue(job("succeeded"));
    const user = await renderImports();

    const dialog = await openUpload(user);
    await upload(user, dialog);
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(uploadSettlementImport).toHaveBeenCalledTimes(2);
    });
    const keys = uploadSettlementImport.mock.calls.map(([, , key]) => key);
    expect(keys[1]).toBe(keys[0]);
  });

  it("requires a file before it asks the server", async () => {
    const user = await renderImports();

    const dialog = await openUpload(user);
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(uploadSettlementImport).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of the upload under its field", async () => {
    uploadSettlementImport.mockRejectedValue(
      ruleViolation("file", "A settlement file is required."),
    );
    const user = await renderImports();

    const dialog = await openUpload(user);
    await upload(user, dialog);

    expect(await within(dialog).findByText("A settlement file is required.")).toBeInTheDocument();
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("hides Upload from a viewer without fees.payment.collect", async () => {
    await renderImports(PAYMENTS_VIEW_PERMISSIONS);

    expect(await screen.findByText("Easypaisa")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Upload settlement file" }),
    ).not.toBeInTheDocument();
  });

  it("opens an import's sheet with the matched count and each exception row's reason", async () => {
    const user = await renderImports(PAYMENTS_VIEW_PERMISSIONS);

    await user.click(await screen.findByRole("button", { name: /View the import uploaded/ }));

    const sheet = await screen.findByRole("dialog", { name: "Settlement import" });
    expect(fetchSettlementImport).toHaveBeenCalledWith(IMPORT_ID);
    const table = await within(sheet).findByRole("table", { name: "Rows that did not post" });
    expect(
      within(table).getByText("No open voucher with consumer number '999' for easypaisa."),
    ).toBeInTheDocument();
    expect(within(table).getByText("TXN-77")).toBeInTheDocument();
    // The server's counts, as sent: 4 rows, 3 matched.
    expect(within(sheet).getByText("Matched").nextElementSibling).toHaveTextContent("3");
    expect(within(sheet).getByText("Rows").nextElementSibling).toHaveTextContent("4");
  });

  it("says every row matched when the import has no exceptions", async () => {
    const user = await renderImports(PAYMENTS_VIEW_PERMISSIONS);
    fetchSettlementImport.mockResolvedValue(importRecord({ exceptions: [], matched_count: 4 }));

    await user.click(await screen.findByRole("button", { name: /View the import uploaded/ }));

    const sheet = await screen.findByRole("dialog", { name: "Settlement import" });
    expect(
      await within(sheet).findByText("Every row in the file was matched and posted."),
    ).toBeInTheDocument();
  });
});
