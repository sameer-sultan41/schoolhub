import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import type * as HelpersModule from "@/lib/helpers";
import { downloadFile } from "@/lib/helpers";
import {
  admitCardPage,
  OTHER_SECTION_ID,
} from "@/services/modules/admit-cards/__tests__/admit-cards-fixtures";
import { sittingRecord } from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";

import {
  asUser,
  fetchAdmitCardDownloadUrl,
  fetchAdmitCardsPage,
  fetchSittings,
  lastArg,
  mocked,
  pick,
  rowOf,
  stubExamsServices,
  urlParam,
} from "../../__tests__/exams-test-support";
import {
  asIssuer,
  CARD_VIEW,
  ISSUED,
  PENDING,
  renderTab,
  REVOKED,
} from "./admit-cards-test-support";

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

const SIGNED_URL = "https://files.example.test/signed/admit-card.pdf";

describe("AdmitCardsTab: the list", () => {
  beforeEach(() => {
    stubExamsServices();
    asUser(CARD_VIEW);
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([ISSUED, REVOKED, PENDING]));
  });

  it("lists each card's number, student, admission number, section and status", async () => {
    await renderTab();

    await screen.findByText(ISSUED.student_name);
    const row = rowOf(ISSUED.student_name);
    expect(row.getByText(ISSUED.admit_card_no)).toBeInTheDocument();
    expect(row.getByText("ADM-001")).toBeInTheDocument();
    expect(row.getByText("A")).toBeInTheDocument();
    expect(row.getByText("Issued")).toBeInTheDocument();
    expect(rowOf(PENDING.student_name).getByText("Awaiting PDF")).toBeInTheDocument();
    expect(lastArg(fetchAdmitCardsPage)).toMatchObject({
      examId: examRecord().id,
      ordering: "admit_card_no",
      sectionId: undefined,
      status: undefined,
    });
  });

  it("shows a revoked card's reason and offers it no download", async () => {
    await renderTab();

    await screen.findByText(REVOKED.student_name);
    const row = rowOf(REVOKED.student_name);
    expect(row.getByText("Revoked")).toBeInTheDocument();
    expect(row.getByText("Reason: Fees outstanding")).toBeInTheDocument();
    expect(
      row.queryByRole("button", { name: "Download Sara Khan's admit card" }),
    ).not.toBeInTheDocument();
  });

  it("hides Download on a card whose PDF the job hasn't written yet", async () => {
    await renderTab();

    await screen.findByText(PENDING.student_name);
    expect(
      rowOf(PENDING.student_name).queryByRole("button", { name: /Download/ }),
    ).not.toBeInTheDocument();
    expect(
      rowOf(ISSUED.student_name).getByRole("button", { name: "Download Ali Raza's admit card" }),
    ).toBeInTheDocument();
  });

  it("downloads through the card's own :download link, never a hand-built URL", async () => {
    fetchAdmitCardDownloadUrl.mockResolvedValue(SIGNED_URL);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Download Ali Raza's admit card" }));

    await waitFor(() => {
      expect(mocked(downloadFile)).toHaveBeenCalledWith(
        SIGNED_URL,
        "admit-card-1A2B3C4D-ADM-001.pdf",
      );
    });
    expect(fetchAdmitCardDownloadUrl).toHaveBeenCalledWith(ISSUED.id);
  });

  it("toasts the server's reason when there is no document to download", async () => {
    fetchAdmitCardDownloadUrl.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "This admit card has no document to download.",
        status: 404,
        url: "/admit-cards/x:download",
        details: [],
      }),
    );
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: "Download Ali Raza's admit card" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(mocked(downloadFile)).not.toHaveBeenCalled();
  });

  it("offers no Revoke without the issue key", async () => {
    await renderTab();

    await screen.findByText(ISSUED.student_name);
    expect(screen.queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it("offers Revoke on a live card only, to a holder of the issue key", async () => {
    asIssuer();
    await renderTab();

    await screen.findByText(ISSUED.student_name);
    expect(
      rowOf(ISSUED.student_name).getByRole("button", { name: "Revoke Ali Raza's admit card" }),
    ).toBeInTheDocument();
    expect(
      rowOf(REVOKED.student_name).queryByRole("button", { name: /Revoke/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AdmitCardsTab: filters", () => {
  beforeEach(() => {
    stubExamsServices();
    asUser(CARD_VIEW);
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([ISSUED]));
    fetchSittings.mockResolvedValue([
      sittingRecord(),
      sittingRecord({ id: "b", section_id: OTHER_SECTION_ID, section_name: "B" }),
    ]);
  });

  it("filters by a section the exam sits in, kept in the URL", async () => {
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);

    await pick(user, "Section", "Grade 5 B");

    await waitFor(() => {
      expect(lastArg(fetchAdmitCardsPage)).toMatchObject({ sectionId: OTHER_SECTION_ID });
    });
    expect(urlParam("section")).toBe(OTHER_SECTION_ID);
  });

  it("filters by status, kept in the URL", async () => {
    const user = await renderTab();
    await screen.findByText(ISSUED.student_name);

    await pick(user, "Status", "Revoked");

    await waitFor(() => {
      expect(lastArg(fetchAdmitCardsPage)).toMatchObject({ status: "revoked" });
    });
    expect(urlParam("status")).toBe("revoked");
  });

  it("says when no card matches the filters", async () => {
    fetchAdmitCardsPage.mockResolvedValue(admitCardPage([]));
    const user = await renderTab();
    await screen.findByText("No admit cards yet");

    await pick(user, "Status", "Revoked");

    expect(await screen.findByText("No admit cards match these filters")).toBeInTheDocument();
  });
});
