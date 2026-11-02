import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import type { ExamRecord } from "@/services";
import { EXAM_ID, examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  OTHER_REPORT_CARD_ID,
  reportCardPage,
  reportCardRecord,
} from "@/services/modules/report-cards/__tests__/report-cards-fixtures";
import { sittingRecord } from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import { renderWithProviders } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import {
  asUser,
  fetchJob,
  fetchReportCardDownloadUrl,
  fetchReportCardsPage,
  fetchSittings,
  generateReportCards,
  lastArg,
  mocked,
  publishReportCards,
  rowOf,
  stubExamsServices,
  updateRemarks,
} from "../../__tests__/exams-test-support";
import { ReportCardsTab } from "../report-cards-tab";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ examsServicesMock: () => unknown }>("../../__tests__/exams-services-mock")
    .examsServicesMock(),
);

jest.mock("@/lib/helpers", () => ({
  ...jest.requireActual<typeof HelpersModule>("@/lib/helpers"),
  downloadFile: jest.fn(),
}));

const VIEW: PermissionKey = "exams.report-card.view";
const CREATE: PermissionKey = "exams.report-card.create";
const PUBLISH: PermissionKey = "exams.report-card.publish";
const SIGNED_URL = "https://files.example.test/signed/report-card.pdf";
const CLASS_TEACHER = "Class teacher's remarks";
const PRINCIPAL = "Principal's remarks";

/** Who writes which remark field (`ReportCardViewSet.REMARK_FIELD_KEYS`). */
const REMARK_CASES: { who: string; keys: PermissionKey[]; shown: string[]; hidden: string[] }[] = [
  { who: "a class teacher", keys: [CREATE], shown: [CLASS_TEACHER], hidden: [PRINCIPAL] },
  { who: "a principal", keys: [PUBLISH], shown: [PRINCIPAL], hidden: [CLASS_TEACHER] },
  {
    who: "a holder of both keys",
    keys: [CREATE, PUBLISH],
    shown: [CLASS_TEACHER, PRINCIPAL],
    hidden: [],
  },
];

/** Ali Raza's rendered card (the fixture's default). */
const GENERATED = reportCardRecord();
/** Sara Khan's card, waiting for its PDF. */
const DRAFT = reportCardRecord({
  id: OTHER_REPORT_CARD_ID,
  student_name: "Sara Khan",
  admission_number: "ADM-002",
  file_id: null,
  status: "draft",
});
const PUBLISHED_EXAM = examRecord({ status: "published" });

async function renderTab(exam: ExamRecord = PUBLISHED_EXAM) {
  renderWithProviders(
    <>
      <UserLoaded />
      <ReportCardsTab exam={exam} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

async function openRemarks(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(GENERATED.student_name);
  await user.click(
    rowOf(GENERATED.student_name).getByRole("button", {
      name: "Edit remarks on Ali Raza's report card",
    }),
  );
  return screen.findByRole("dialog", { name: "Remarks on Ali Raza's report card" });
}

describe("ReportCardsTab: the list", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=report-cards`);
    asUser(VIEW);
    fetchReportCardsPage.mockResolvedValue(reportCardPage([GENERATED, DRAFT]));
  });

  it("lists the cards and downloads through the card's own :download once its PDF exists", async () => {
    fetchReportCardDownloadUrl.mockResolvedValue(SIGNED_URL);
    const user = await renderTab();

    await screen.findByText(GENERATED.student_name);
    expect(rowOf(DRAFT.student_name).getByText("Awaiting PDF")).toBeInTheDocument();
    expect(rowOf(DRAFT.student_name).queryByRole("button", { name: /Download/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Download Ali Raza's report card" }));

    await waitFor(() => {
      expect(mocked(downloadFile)).toHaveBeenCalledWith(SIGNED_URL, "report-card-ADM-001-v1.pdf");
    });
    expect(fetchReportCardDownloadUrl).toHaveBeenCalledWith(GENERATED.id);
    expect(lastArg(fetchReportCardsPage)).toMatchObject({ examId: EXAM_ID, status: undefined });
  });

  it("offers no Remarks, Generate or Publish to a viewer alone", async () => {
    await renderTab();

    await screen.findByText(GENERATED.student_name);
    expect(screen.queryByRole("button", { name: /remarks/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate|Publish/ })).not.toBeInTheDocument();
  });

  it("hides the section filter, and never reads the sittings, without the schedule key", async () => {
    await renderTab();

    await screen.findByText(GENERATED.student_name);
    expect(screen.queryByRole("combobox", { name: "Section" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(fetchSittings).not.toHaveBeenCalled();
  });

  it("offers the exam's sections to a holder of the schedule key", async () => {
    asUser(VIEW, "exams.schedule.view");
    fetchSittings.mockResolvedValue([sittingRecord()]);
    await renderTab();

    await screen.findByText(GENERATED.student_name);
    expect(screen.getByRole("combobox", { name: "Section" })).toBeInTheDocument();
    expect(fetchSittings).toHaveBeenCalledWith(EXAM_ID);
  });
});

describe("ReportCardsTab: Remarks", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=report-cards`);
    fetchReportCardsPage.mockResolvedValue(reportCardPage([GENERATED]));
    updateRemarks.mockResolvedValue(GENERATED);
  });

  it.each(REMARK_CASES)("shows $who only the remark fields their keys write", async (row) => {
    const { keys, shown, hidden } = row;
    asUser(VIEW, ...keys);
    const user = await renderTab();

    const dialog = await openRemarks(user);

    for (const label of shown) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    for (const label of hidden) {
      expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument();
    }
  });

  it("sends only the field the class teacher may write", async () => {
    asUser(VIEW, CREATE);
    const user = await renderTab();

    const dialog = await openRemarks(user);
    await user.type(within(dialog).getByLabelText(CLASS_TEACHER), "Works hard.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateRemarks).toHaveBeenCalledWith(GENERATED.id, {
        class_teacher_remarks: "Works hard.",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("Remarks on Ali Raza's report card saved.");
  });

  it("shows the server's 403 naming a field the viewer may not write", async () => {
    asUser(VIEW, PUBLISH);
    const refusal = "You do not have permission to write principal_remarks.";
    updateRemarks.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: refusal,
        status: 403,
        url: "/report-cards/x",
        details: [{ field: "principal_remarks", issue: refusal }],
      }),
    );
    const user = await renderTab();

    const dialog = await openRemarks(user);
    await user.type(within(dialog).getByLabelText(PRINCIPAL), "Excellent.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
  });

  it("is not offered on a published card", async () => {
    asUser(VIEW, CREATE, PUBLISH);
    fetchReportCardsPage.mockResolvedValue(reportCardPage([{ ...GENERATED, status: "published" }]));
    await renderTab();

    await screen.findByText(GENERATED.student_name);
    expect(screen.queryByRole("button", { name: /remarks/i })).not.toBeInTheDocument();
  });
});

describe("ReportCardsTab: Generate and Publish", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=report-cards`);
    asUser(VIEW, CREATE, PUBLISH);
    fetchReportCardsPage.mockResolvedValue(reportCardPage([GENERATED]));
  });

  it("is offered only once the exam's results are published", async () => {
    await renderTab(examRecord({ status: "approved" }));

    await screen.findByText(GENERATED.student_name);
    expect(screen.queryByRole("button", { name: "Generate report cards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish report cards" })).not.toBeInTheDocument();
  });

  it("generates with an Idempotency-Key, polls the render job and reloads the cards", async () => {
    generateReportCards.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue({
      id: "job-1",
      job_type: "exams.report-cards",
      status: "succeeded",
      progress: 100,
      result: { rendered: 1, failed: [], cards: 1 },
      error: null,
    });
    const user = await renderTab();
    await screen.findByText(GENERATED.student_name);
    const reads = fetchReportCardsPage.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Generate report cards" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("1 report card is ready.");
    });
    expect(generateReportCards).toHaveBeenCalledWith(EXAM_ID, expect.any(String));
    expect(fetchReportCardsPage.mock.calls.length).toBeGreaterThan(reads);
  });

  it("warns with the job's own count of cards that failed to render", async () => {
    generateReportCards.mockResolvedValue({ jobId: "job-1" });
    fetchJob.mockResolvedValue({
      id: "job-1",
      job_type: "exams.report-cards",
      status: "succeeded",
      progress: 100,
      result: {
        rendered: 2,
        failed: [{ student_id: "s3", error: "Renderer timed out" }],
        cards: 3,
      },
      error: null,
    });
    const user = await renderTab();
    await screen.findByText(GENERATED.student_name);

    await user.click(screen.getByRole("button", { name: "Generate report cards" }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        "2 report cards are ready; 1 couldn't be rendered. Generate again to retry them.",
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("publishes and reports the server's count", async () => {
    publishReportCards.mockResolvedValue({ published: 3, published_ids: [] });
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Publish report cards" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Publish report cards" }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("3 report cards published.");
    });
  });
});
