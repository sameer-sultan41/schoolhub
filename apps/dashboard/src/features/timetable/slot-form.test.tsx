import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlotEditorDialog } from "@/features/timetable/slot-form";
import type { TimetableSlotRecord } from "@/features/timetable/timetable-types";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useSubjectOptions: () => ({ data: [{ id: "sub1", name: "Mathematics", code: "MATH" }] }),
  useRoomOptions: () => ({ data: [{ id: "room1", code: "L-12", name: "Physics Lab" }] }),
  useTeachingStaffOptions: () => ({
    data: [{ id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" }],
  }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const EXISTING_SLOT = {
  id: "slot1",
  academic_session_id: "sess1",
  section_id: "sec1",
  day_of_week: 0,
  period_id: "p1",
  subject_id: "sub1",
  staff_id: "staff1",
  room_id: "room1",
  status: "draft" as const,
  effective_from: null,
  effective_to: null,
  notes: "double period",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

function renderDialog({ slot }: { slot?: TimetableSlotRecord } = {}) {
  const onConflicts = jest.fn();
  const onOpenChange = jest.fn();
  renderWithProviders(
    <SlotEditorDialog
      open
      onOpenChange={onOpenChange}
      academicSessionId="sess1"
      sectionId="sec1"
      dayOfWeek={0}
      periodId="p1"
      cellLabel="Monday · Period 1"
      onConflicts={onConflicts}
      slot={slot}
    />,
  );
  return { onConflicts, onOpenChange };
}

describe("SlotEditorDialog", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(true);
  });

  it("names the cell it is editing", () => {
    renderDialog({ slot: EXISTING_SLOT });

    expect(screen.getByText("Monday · Period 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit this period" })).toBeInTheDocument();
  });

  it("creates a draft slot, sending null for the fields left empty", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/timetable-slots", {
        academic_session_id: "sess1",
        section_id: "sec1",
        day_of_week: 0,
        period_id: "p1",
        subject_id: "sub1",
        staff_id: null,
        room_id: null,
        notes: null,
      });
    });
  });

  it("patches an existing slot rather than creating a second one", async () => {
    mockPatch.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();
    renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        "/timetable-slots/slot1",
        expect.objectContaining({ subject_id: "sub1", staff_id: "staff1", room_id: "room1" }),
      );
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("hands the write's meta.conflicts back to the grid", async () => {
    const conflict = {
      type: "teacher_double_booked",
      severity: "hard" as const,
      slot_ids: ["slot1", "slot2"],
      message: "This teacher is already teaching in this period.",
    };
    mockPatch.mockResolvedValue({
      data: {},
      meta: { conflicts: [conflict] },
      requestId: null,
      status: 200,
    });
    const user = userEvent.setup();
    const { onConflicts } = renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onConflicts).toHaveBeenCalledWith([conflict]);
    });
  });

  it("clears the cell and reports whatever that resolved", async () => {
    mockDelete.mockResolvedValue({
      data: null,
      meta: { conflicts: [] },
      requestId: null,
      status: 204,
    });
    const user = userEvent.setup();
    const { onConflicts } = renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Clear this period" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/timetable-slots/slot1");
    });
    expect(onConflicts).toHaveBeenCalledWith([]);
  });

  it("routes a server field error onto the field it names", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/timetable-slots/slot1",
        details: [{ field: "staff_id", issue: "Only teaching staff can be scheduled." }],
      }),
    );
    const user = userEvent.setup();
    renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Only teaching staff can be scheduled.")).toBeInTheDocument();
  });

  it("routes a field the dialog does not render into the root message", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/timetable-slots/slot1",
        details: [{ field: "period_id", issue: "This period is a break." }],
      }),
    );
    const user = userEvent.setup();
    renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This period is a break.");
  });

  it("renders the envelope when the server refuses to edit a published slot", async () => {
    mockPatch.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "This slot is published.",
        status: 409,
        url: "/timetable-slots/slot1",
        requestId: "req-9",
      }),
    );
    const user = userEvent.setup();
    renderDialog({ slot: EXISTING_SLOT });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-9/)).toBeInTheDocument();
  });

  it("hides the save and clear controls from a user who holds neither key", () => {
    mockUsePermission.mockReturnValue(false);
    renderDialog({ slot: EXISTING_SLOT });

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear this period" })).not.toBeInTheDocument();
  });

  it("shows the allocation hint only once both a subject and a teacher are chosen", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(
      screen.queryByText("This teacher must already be allocated to this section and subject."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));
    await user.click(screen.getByRole("combobox", { name: "Teacher" }));
    await user.click(await screen.findByRole("option", { name: "Bilal Ahmed" }));

    expect(
      await screen.findByText(
        "This teacher must already be allocated to this section and subject.",
      ),
    ).toBeInTheDocument();
  });
});
