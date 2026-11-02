import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  conflictRecord,
  SITTING_ID,
  sittingRecord,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";

import {
  asUser,
  cancelSitting,
  deleteSitting,
  fetchConflicts,
  fetchSittings,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import {
  apiError,
  asScheduler,
  HARD,
  renderTab,
  SCHEDULE_CREATE,
  SCHEDULE_UPDATE,
  SCHEDULE_VIEW,
  SECOND,
  SOFT,
} from "./schedule-test-support";

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

describe("ScheduleTab", () => {
  beforeEach(() => {
    stubExamsServices();
    asUser(SCHEDULE_VIEW);
    fetchSittings.mockResolvedValue([sittingRecord(), SECOND]);
  });

  describe("reading", () => {
    it("reads the exam's whole schedule and its clash list, by the exam's id", async () => {
      await renderTab();

      await screen.findByText("English");
      expect(fetchSittings).toHaveBeenCalledWith(examRecord().id);
      expect(fetchConflicts).toHaveBeenCalledWith(examRecord().id);
    });

    it("groups the sittings by date, each day's by start time", async () => {
      fetchSittings.mockResolvedValue([
        SECOND,
        sittingRecord({
          id: "late",
          subject_name: "Science",
          exam_date: "2026-10-06",
          start_time: "08:00:00",
        }),
        sittingRecord(),
      ]);

      await renderTab();

      expect(
        await screen.findByRole("heading", { name: "Monday, October 5, 2026" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Tuesday, October 6, 2026" })).toBeInTheDocument();
      const tables = screen.getAllByRole("table");
      expect(tables).toHaveLength(2);
      const subjects = (table: HTMLElement) =>
        within(table)
          .getAllByRole("row")
          .slice(1)
          .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
      expect(subjects(tables[0] as HTMLElement)).toEqual(["Mathematics", "English"]);
      expect(subjects(tables[1] as HTMLElement)).toEqual(["Science"]);
    });

    it("shows a sitting's time, section, room, invigilator and status", async () => {
      await renderTab();

      const row = (await screen.findByText("Mathematics")).closest("tr");
      if (!row) throw new Error("row not rendered");
      expect(within(row).getByText("09:00 to 11:00")).toBeInTheDocument();
      expect(within(row).getByText("Grade 5 A")).toBeInTheDocument();
      expect(within(row).getByText("Room 101")).toBeInTheDocument();
      expect(within(row).getByText("Ayesha Khan")).toBeInTheDocument();
      expect(within(row).getByText("Scheduled")).toBeInTheDocument();
    });

    it("says there are no sittings, read-only for a viewer who cannot add", async () => {
      fetchSittings.mockResolvedValue([]);

      await renderTab();

      expect(await screen.findByText("No sittings yet")).toBeInTheDocument();
      expect(
        screen.getByText("No sittings have been scheduled for this exam."),
      ).toBeInTheDocument();
    });

    it("keeps the schedule readable when the clash list fails, and holds Publish", async () => {
      asScheduler();
      fetchConflicts.mockRejectedValue(apiError(500, "server_error", "boom"));

      await renderTab();

      expect(await screen.findByText("The clashes couldn't be checked.")).toBeInTheDocument();
      expect(screen.getByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Publish schedule" })).toBeDisabled();
    });
  });

  describe("the clash markers and panel", () => {
    beforeEach(() => {
      fetchConflicts.mockResolvedValue([SOFT, HARD]);
    });

    it("marks each sitting a finding names, by its worst severity, and no other", async () => {
      fetchConflicts.mockResolvedValue([
        SOFT,
        HARD,
        conflictRecord({
          type: "room_over_capacity",
          severity: "soft",
          schedule_ids: ["soft-only"],
        }),
      ]);
      fetchSittings.mockResolvedValue([
        sittingRecord(),
        SECOND,
        sittingRecord({ id: "soft-only", subject_name: "Art", start_time: "14:30:00" }),
        sittingRecord({ id: "clear", subject_name: "Science", start_time: "15:00:00" }),
      ]);

      await renderTab();

      await screen.findAllByText("Blocking clash");
      const rowFor = (name: string) => {
        const row = screen.getByText(name).closest("tr");
        if (!row) throw new Error(`no row for ${name}`);
        return within(row);
      };
      expect(rowFor("Mathematics").getByText("Blocking clash")).toBeInTheDocument();
      // English is named by a hard and a soft finding: the worse one shows.
      expect(rowFor("English").getByText("Blocking clash")).toBeInTheDocument();
      expect(rowFor("English").queryByText("Clash warning")).not.toBeInTheDocument();
      expect(rowFor("Art").getByText("Clash warning")).toBeInTheDocument();
      expect(rowFor("Science").queryByText(/clash/i)).not.toBeInTheDocument();
    });

    it("lists hard findings first whatever order they arrive in, each with badge, label and message", async () => {
      await renderTab();

      const list = await screen.findByRole("list", { name: "Clashes" });
      const badges = within(list).getAllByText(/^(Blocking|Warning)$/);
      expect(badges.map((badge) => badge.textContent)).toEqual(["Blocking", "Warning"]);
      expect(
        within(list).getByText("A room is booked for two sittings at the same time."),
      ).toBeInTheDocument();
      expect(within(list).getByText(HARD.message)).toBeInTheDocument();
      expect(within(list).getByText(SOFT.message)).toBeInTheDocument();
    });

    it("names the sittings each finding involves", async () => {
      await renderTab();

      const involved = await screen.findAllByRole("list", { name: "Sittings involved" });
      expect(involved).toHaveLength(2);
      const both = involved.find((list) => within(list).queryAllByRole("listitem").length === 2);
      if (!both) throw new Error("no finding names two sittings");
      // Localised: the class-section and time-range messages, and the viewer's long date.
      const date = "Monday, October 5, 2026";
      expect(
        within(both).getByText(`Mathematics · Grade 5 A · ${date} · 09:00 to 11:00`),
      ).toBeInTheDocument();
      expect(
        within(both).getByText(`English · Grade 5 B · ${date} · 13:00 to 14:00`),
      ).toBeInTheDocument();
    });

    it("says so when there are no clashes", async () => {
      fetchConflicts.mockResolvedValue([]);

      await renderTab();

      expect(await screen.findByText("No clashes found.")).toBeInTheDocument();
    });
  });

  describe("write controls", () => {
    it("shows a viewer holding only the view key no add, reschedule, cancel, delete or publish", async () => {
      await renderTab();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add sitting" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^(Reschedule|Cancel|Delete) / }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Publish schedule" })).not.toBeInTheDocument();
    });

    it("offers Add sitting to a holder of the create key alone, and no row actions", async () => {
      asUser(SCHEDULE_VIEW, SCHEDULE_CREATE);

      await renderTab();

      expect(await screen.findByRole("button", { name: "Add sitting" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^(Reschedule|Cancel|Delete) / }),
      ).not.toBeInTheDocument();
    });

    it("offers an updater reschedule, cancel and delete on a scheduled sitting of a draft exam, but not Add", async () => {
      asUser(SCHEDULE_VIEW, SCHEDULE_UPDATE);

      await renderTab();

      expect(
        await screen.findByRole("button", { name: "Reschedule Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Delete Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add sitting" })).not.toBeInTheDocument();
    });

    it("offers Delete only on a draft exam", async () => {
      asScheduler();

      await renderTab(examRecord({ status: "scheduled" }));

      expect(
        await screen.findByRole("button", { name: "Reschedule Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    });

    it("keeps Add and Reschedule off an exam past scheduled, leaving Cancel for an updater", async () => {
      asScheduler();

      await renderTab(examRecord({ status: "ongoing" }));

      expect(
        await screen.findByRole("button", { name: "Cancel Mathematics, Grade 5 A" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add sitting" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^(Reschedule|Delete) / }),
      ).not.toBeInTheDocument();
    });

    it("offers no action on a cancelled or completed sitting", async () => {
      asScheduler();
      fetchSittings.mockResolvedValue([
        sittingRecord({ status: "cancelled" }),
        SECOND,
        sittingRecord({ id: "done", subject_name: "Science", status: "completed" }),
      ]);

      await renderTab();

      expect(await screen.findByText("Cancelled")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /(Mathematics|Science), Grade 5 A$/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel English, Grade 5 B" })).toBeInTheDocument();
    });
  });

  describe("cancel and delete", () => {
    beforeEach(() => {
      asScheduler();
    });

    it("calls a sitting off after a confirm: the clash list comes from the answer, the rest reloads", async () => {
      const clash = conflictRecord();
      cancelSitting.mockResolvedValue({
        sitting: sittingRecord({ status: "cancelled" }),
        conflicts: [clash],
      });
      fetchConflicts.mockResolvedValue([]);
      const user = await renderTab();
      await screen.findByText("No clashes found.");
      const conflictReads = fetchConflicts.mock.calls.length;
      const sittingReads = fetchSittings.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Cancel Mathematics, Grade 5 A" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel sitting" }));

      await waitFor(() => {
        expect(cancelSitting).toHaveBeenCalledWith(SITTING_ID);
      });
      expect(await screen.findByText(clash.message)).toBeInTheDocument();
      await waitFor(() => {
        expect(fetchSittings.mock.calls.length).toBeGreaterThan(sittingReads);
      });
      expect(fetchConflicts).toHaveBeenCalledTimes(conflictReads);
      expect(deleteSitting).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("Sitting cancelled.");
    });

    it("deletes a sitting after a confirm, then reloads the clash list: a delete answers with none", async () => {
      deleteSitting.mockResolvedValue(undefined);
      const user = await renderTab();
      await screen.findByText("Mathematics");
      const conflictReads = fetchConflicts.mock.calls.length;

      await user.click(
        await screen.findByRole("button", { name: "Delete Mathematics, Grade 5 A" }),
      );
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete sitting" }));

      await waitFor(() => {
        expect(deleteSitting).toHaveBeenCalledWith(SITTING_ID);
      });
      await waitFor(() => {
        expect(fetchConflicts.mock.calls.length).toBeGreaterThan(conflictReads);
      });
      expect(cancelSitting).not.toHaveBeenCalled();
    });

    it("shows the server's own sentence when the sitting moved on, keeping the dialog open", async () => {
      const refusal = "This sitting is completed and can no longer be rescheduled.";
      cancelSitting.mockRejectedValue(apiError(409, "conflict", refusal));
      const user = await renderTab();

      await user.click(
        await screen.findByRole("button", { name: "Cancel Mathematics, Grade 5 A" }),
      );
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel sitting" }));

      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    });
  });
});
