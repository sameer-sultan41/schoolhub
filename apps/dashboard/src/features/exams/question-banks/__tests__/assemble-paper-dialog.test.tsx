import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import {
  BANK_ID,
  bankRecord,
  FILE_ID,
} from "@/services/modules/question-banks/__tests__/question-banks-fixtures";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { renderWithProviders } from "@/test-utils";

import { AssemblePaperDialog, usePaperDownload } from "../assemble-paper-dialog";
import { BankHeader } from "../bank-header";
import {
  asUser,
  assemblePaper,
  fetchFileDownloadUrl,
  fetchJob,
  mocked,
  stubQuestionBankServices,
} from "./question-banks-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ questionBanksServicesMock: () => unknown }>("./question-banks-services-mock")
    .questionBanksServicesMock(),
);

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

const SIGNED_URL = "https://files.example.test/signed/paper.pdf";
const SHORT_MESSAGE =
  "2 section(s) of this blueprint cannot be filled from the bank's approved questions.";

/** The dialog with the paper job its page would hold. */
function DialogWithJob() {
  const paper = usePaperDownload();
  return <AssemblePaperDialog open onOpenChange={jest.fn()} bank={bankRecord()} paper={paper} />;
}

function renderDialog() {
  renderWithProviders(<DialogWithJob />);
  return userEvent.setup();
}

function paperJob(status: "running" | "succeeded") {
  return {
    id: "job-1",
    job_type: "exams.assemble-paper",
    status,
    progress: status === "running" ? 40 : 100,
    result:
      status === "running" ? null : { result_file_id: FILE_ID, questions: 5, total_marks: "12.00" },
    error: null,
  };
}

/** Fills the title and section `index`'s count (and topic, when given). */
async function fillSection(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  count: string,
  topic?: string,
) {
  const section = within(screen.getByRole("group", { name: `Section ${index + 1}` }));
  await user.type(section.getByLabelText("Questions"), count);
  if (topic) await user.type(section.getByLabelText("Topic"), topic);
}

describe("AssemblePaperDialog", () => {
  beforeEach(() => {
    stubQuestionBankServices();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("says to download the paper now, since papers are not kept", () => {
    renderDialog();

    expect(
      screen.getByText(/Papers aren't kept on SchoolHub, so save the file then/),
    ).toBeInTheDocument();
  });

  it("sends the blueprint, polls the job and downloads its file", async () => {
    assemblePaper.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue(paperJob("succeeded"));
    fetchFileDownloadUrl.mockResolvedValue(SIGNED_URL);
    const user = renderDialog();

    await user.type(screen.getByLabelText("Paper title"), "Term test");
    await fillSection(user, 0, "3", "Primes");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await fillSection(user, 1, "2");
    await user.click(screen.getByRole("button", { name: "Assemble paper" }));

    await waitFor(() => {
      expect(mocked(downloadFile)).toHaveBeenCalledWith(SIGNED_URL, "Term test.pdf");
    });
    expect(assemblePaper).toHaveBeenCalledWith(BANK_ID, {
      title: "Term test",
      sections: [
        { difficulty: "medium", count: 3, topic: "Primes" },
        { difficulty: "medium", count: 2 },
      ],
    });
    expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    expect(toast.success).toHaveBeenCalledWith("Paper downloaded: 5 questions, 12.00 marks.");
  });

  it("lists every section the bank cannot fill, and starts no job", async () => {
    assemblePaper.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: SHORT_MESSAGE,
        url: "/question-banks",
        details: [{ field: "non_field", issue: SHORT_MESSAGE }],
        meta: {
          sections: [
            { index: 0, difficulty: "medium", topic: "Primes", requested: 3, available: 1 },
            { index: 1, difficulty: "medium", topic: null, requested: 9, available: 4 },
          ],
        },
      }),
    );
    const user = renderDialog();

    await user.type(screen.getByLabelText("Paper title"), "Term test");
    await fillSection(user, 0, "3", "Primes");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await fillSection(user, 1, "9");
    await user.click(screen.getByRole("button", { name: "Assemble paper" }));

    expect(
      await screen.findByText(
        "Section 1 asks for 3 medium questions on Primes; the bank has 1 approved.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Section 2 asks for 9 medium questions; the bank has 4 approved."),
    ).toBeInTheDocument();
    expect(screen.getByText(SHORT_MESSAGE)).toBeInTheDocument();
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("refuses a section with no count before sending, and removes an extra section", async () => {
    const user = renderDialog();

    await user.type(screen.getByLabelText("Paper title"), "Term test");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await user.click(screen.getByRole("button", { name: "Remove section 2" }));
    expect(screen.queryByRole("group", { name: "Section 2" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assemble paper" }));

    expect(await screen.findByText("Enter a whole number from 1 to 200.")).toBeInTheDocument();
    expect(assemblePaper).not.toHaveBeenCalled();
  });

  it("toasts the job's own failure", async () => {
    assemblePaper.mockResolvedValue({ jobId: "job-2" });
    fetchJob.mockResolvedValue({
      id: "job-2",
      job_type: "exams.assemble-paper",
      status: "failed",
      progress: 0,
      result: null,
      error: "The bank changed after the blueprint was accepted.",
    });
    const user = renderDialog();

    await user.type(screen.getByLabelText("Paper title"), "Term test");
    await fillSection(user, 0, "1");
    await user.click(screen.getByRole("button", { name: "Assemble paper" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "The bank changed after the blueprint was accepted.",
      );
    });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("still downloads the paper when the dialog is closed mid-job", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    asUser("exams.question-bank.update");
    assemblePaper.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValueOnce(paperJob("running")).mockResolvedValue(paperJob("succeeded"));
    fetchFileDownloadUrl.mockResolvedValue(SIGNED_URL);
    renderWithProviders(
      <>
        <UserLoaded />
        <BankHeader bank={bankRecord()} />
      </>,
    );
    await screen.findByText(USER_LOADED);
    const user = userEvent.setup({ delay: null });

    await user.click(screen.getByRole("button", { name: "Assemble paper" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByLabelText("Paper title"), "Term test");
    await user.type(dialog.getByLabelText("Questions"), "3");
    await user.click(dialog.getByRole("button", { name: "Assemble paper" }));
    expect(await dialog.findByText("Assembling the paper: 40%")).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(downloadFile).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2000);

    await waitFor(() => {
      expect(mocked(downloadFile)).toHaveBeenCalledWith(SIGNED_URL, "Term test.pdf");
    });
    expect(toast.success).toHaveBeenCalledWith("Paper downloaded: 5 questions, 12.00 marks.");
  });
});
