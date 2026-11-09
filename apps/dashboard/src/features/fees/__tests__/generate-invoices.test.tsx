import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { InvoicesHome } from "@/features/fees/invoices/invoices-home";
import {
  asUser,
  fetchJob,
  generateFeeInvoices,
  INVOICING_PERMISSIONS,
  listFeeInvoices,
  ruleViolation,
  STRUCTURE_ID,
  stubFeesServices,
  TERM_ID,
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

function job(overrides: Partial<BackgroundJobRecord> = {}): BackgroundJobRecord {
  return {
    id: "job-1",
    job_type: "fees.generate-invoices",
    status: "succeeded",
    progress: 100,
    result: { issued: 3, skipped: 2, rows: [] },
    error: null,
    ...overrides,
  };
}

async function openDialog() {
  renderWithProviders(
    <>
      <UserLoaded />
      <InvoicesHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Generate invoices" }));
  const dialog = await screen.findByRole("dialog", { name: "Generate invoices" });
  return { user, dialog };
}

/** Picks the active structure and types the month, then submits. */
async function generateForMonth(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  month = "2026-10",
) {
  await user.click(await within(dialog).findByRole("combobox", { name: "Fee structure" }));
  await user.click(await screen.findByRole("option", { name: "Grade 1 fees" }));
  fireEvent.change(within(dialog).getByLabelText("Month"), { target: { value: month } });
  await user.click(within(dialog).getByRole("button", { name: "Generate" }));
}

describe("generate invoices", () => {
  beforeEach(() => {
    stubFeesServices("/fees/invoices");
    asUser(...INVOICING_PERMISSIONS);
    generateFeeInvoices.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue(job());
  });

  it("queues the month's run with an Idempotency-Key and shows the job's created and skipped counts", async () => {
    const { user, dialog } = await openDialog();
    const reads = listFeeInvoices.mock.calls.length;

    await generateForMonth(user, dialog);

    expect(await within(dialog).findByText("3 invoices created")).toBeInTheDocument();
    expect(within(dialog).getByText(/2 students skipped/)).toBeInTheDocument();
    expect(generateFeeInvoices).toHaveBeenCalledWith(
      { feeStructureId: STRUCTURE_ID, periodStart: "2026-10-01", termId: null },
      expect.any(String),
    );
    expect(fetchJob).toHaveBeenCalledWith("job-1");
    // The list reloads on acceptance and again when the job ends.
    await waitFor(() => {
      expect(listFeeInvoices.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("reuses the Idempotency-Key when the same request is retried after a failed one", async () => {
    generateFeeInvoices.mockRejectedValueOnce(new Error("network down"));
    const { user, dialog } = await openDialog();

    await generateForMonth(user, dialog);
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(await within(dialog).findByText("3 invoices created")).toBeInTheDocument();
    const keys = generateFeeInvoices.mock.calls.map(([, key]) => key);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("uses a new Idempotency-Key once the form changed, as the body is a different request", async () => {
    generateFeeInvoices.mockRejectedValueOnce(new Error("network down"));
    const { user, dialog } = await openDialog();

    await generateForMonth(user, dialog, "2026-10");
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Month"), { target: { value: "2026-11" } });
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(generateFeeInvoices).toHaveBeenCalledTimes(2);
    });
    const keys = generateFeeInvoices.mock.calls.map(([, key]) => key);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("says nothing new was billed, not an error, when a re-run skips everyone", async () => {
    fetchJob.mockResolvedValue(job({ result: { issued: 0, skipped: 5, rows: [] } }));
    const { user, dialog } = await openDialog();

    await generateForMonth(user, dialog);

    expect(
      await within(dialog).findByText(
        "Nothing new to bill: everyone was already billed for this period.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/5 students skipped/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("bills a term instead of a month", async () => {
    const { user, dialog } = await openDialog();

    await user.click(await within(dialog).findByRole("combobox", { name: "Fee structure" }));
    await user.click(await screen.findByRole("option", { name: "Grade 1 fees" }));
    await user.click(within(dialog).getByRole("radio", { name: "A term" }));
    await user.click(await within(dialog).findByRole("combobox", { name: "Term" }));
    await user.click(await screen.findByRole("option", { name: "Term 1" }));
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(generateFeeInvoices).toHaveBeenCalledWith(
        { feeStructureId: STRUCTURE_ID, periodStart: null, termId: TERM_ID },
        expect.any(String),
      );
    });
  });

  it("shows the job's own sentence when the run fails", async () => {
    fetchJob.mockResolvedValue(
      job({ status: "failed", result: null, error: "2026-12-01 falls outside 2026-27." }),
    );
    const { user, dialog } = await openDialog();

    await generateForMonth(user, dialog, "2026-12");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "2026-12-01 falls outside 2026-27.",
    );
  });

  it("keeps the dialog open with the server's refusal when the structure cannot bill", async () => {
    generateFeeInvoices.mockRejectedValue(
      ruleViolation(
        "fee_structure",
        "'Grade 1 fees' is draft. Only an active structure prices invoices.",
      ),
    );
    const { user, dialog } = await openDialog();

    await generateForMonth(user, dialog);

    expect(
      await within(dialog).findByText(
        "'Grade 1 fees' is draft. Only an active structure prices invoices.",
      ),
    ).toBeInTheDocument();
    expect(fetchJob).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Generate invoices" })).toBeInTheDocument();
  });

  it("requires the month before it asks the server", async () => {
    const { user, dialog } = await openDialog();

    await user.click(await within(dialog).findByRole("combobox", { name: "Fee structure" }));
    await user.click(await screen.findByRole("option", { name: "Grade 1 fees" }));
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(generateFeeInvoices).not.toHaveBeenCalled();
  });
});
