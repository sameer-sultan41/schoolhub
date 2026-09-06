import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePermission } from "@/hooks/use-session";
import { WeekGridScreen } from "@/features/timetable/week-grid-screen";
import { apiClient } from "@/lib/auth";
import { cursorPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/timetable" }));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 7" }] }),
}));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  usePeriodOptions: () => ({
    data: [
      {
        id: "p1",
        campus_id: null,
        name: "Period 1",
        sequence: 1,
        start_time: "08:00:00",
        end_time: "08:40:00",
        is_break: false,
        weekdays: null,
      },
      {
        id: "p2",
        campus_id: null,
        name: "Recess",
        sequence: 2,
        start_time: "08:40:00",
        end_time: "09:00:00",
        is_break: true,
        weekdays: null,
      },
      {
        id: "p3",
        campus_id: null,
        name: "Friday assembly",
        sequence: 3,
        start_time: "09:00:00",
        end_time: "09:40:00",
        is_break: false,
        weekdays: [4],
      },
    ],
  }),
  useRoomOptions: () => ({ data: [{ id: "room1", code: "L-12", name: "Physics Lab" }] }),
  useSectionOptions: () => ({ data: [{ id: "sec1", name: "A", class_id: "class1" }] }),
  useSubjectOptions: () => ({ data: [{ id: "sub1", name: "Mathematics" }] }),
  useTeachingStaffOptions: () => ({
    data: [{ id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" }],
  }),
}));
// The cell editor has its own spec; stubbing it keeps this one about the grid.
jest.mock("@/features/timetable/slot-form", () => ({
  SlotEditorDialog: ({
    dayOfWeek,
    periodId,
    slot,
  }: {
    dayOfWeek: number;
    periodId: string;
    slot?: { id: string };
  }) => (
    <div
      data-testid="slot-editor"
      data-day={String(dayOfWeek)}
      data-period={periodId}
      data-slot={slot?.id ?? ""}
    />
  ),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const MONDAY_MATHS = {
  id: "slot1",
  academic_session_id: "sess1",
  section_id: "sec1",
  day_of_week: 0,
  period_id: "p1",
  subject_id: "sub1",
  staff_id: "staff1",
  room_id: "room1",
  status: "draft",
  effective_from: null,
  effective_to: null,
  notes: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

/** Pick a session and a section — the grid query is disabled until both are set. */
async function chooseSectionAndSession(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Academic session" }));
  await user.click(await screen.findByRole("option", { name: "2026-27" }));
  await user.click(screen.getByRole("combobox", { name: "Section" }));
  await user.click(await screen.findByRole("option", { name: "Grade 7 A" }));
}

describe("WeekGridScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockGet.mockResolvedValue(cursorPage([MONDAY_MATHS]));
  });

  it("asks for a session and a section before fetching anything", () => {
    renderWithProviders(<WeekGridScreen />);

    expect(
      screen.getByText("Pick an academic session and a section to build its week."),
    ).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders a filled cell with its subject, teacher and room", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("L-12")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("scopes the request to the chosen session and section", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        academic_session_id: "sess1",
        section_id: "sec1",
      });
    });
  });

  it("renders a break as unschedulable rather than as an empty cell", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await screen.findByText("Mathematics");
    const breakRow = screen.getByRole("row", { name: /Recess/ });
    expect(within(breakRow).getAllByText("Break").length).toBeGreaterThan(0);
    expect(within(breakRow).queryAllByRole("button")).toHaveLength(0);
  });

  it("marks a weekday a period does not run on as not scheduled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await screen.findByText("Mathematics");
    const assemblyRow = screen.getByRole("row", { name: /Friday assembly/ });
    // Runs on weekday 4 only, so Monday-Thursday are closed and Friday is open.
    expect(within(assemblyRow).getAllByText("Not scheduled")).toHaveLength(4);
    expect(within(assemblyRow).getAllByRole("button")).toHaveLength(1);
  });

  it("opens the cell editor pointed at the clicked cell", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await screen.findByText("Mathematics");
    await user.click(screen.getByRole("button", { name: "Edit Monday · Period 1" }));

    const editor = screen.getByTestId("slot-editor");
    expect(editor).toHaveAttribute("data-day", "0");
    expect(editor).toHaveAttribute("data-period", "p1");
    expect(editor).toHaveAttribute("data-slot", "slot1");
  });

  it("offers to fill an empty cell", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await screen.findByText("Mathematics");
    await user.click(screen.getByRole("button", { name: "Fill Tuesday · Period 1" }));

    expect(screen.getByTestId("slot-editor")).toHaveAttribute("data-slot", "");
  });

  it("renders a validation run's findings, translated", async () => {
    mockUsePermission.mockReturnValue(true);
    mockPost.mockResolvedValue({
      data: {
        conflicts: [
          {
            type: "teacher_double_booked",
            severity: "hard",
            slot_ids: ["slot1", "slot9"],
            message: "raw server text",
          },
        ],
      },
      meta: undefined,
      requestId: "req-validate",
      status: 200,
    });
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("button", { name: "Check for conflicts" }));

    // Scoped to the panel: a finding that names a rendered cell also appears on
    // that cell, by design. `getByText` across the whole screen would find both.
    const panel = await screen.findByRole("status");
    expect(
      await within(panel).findByText("This teacher is already teaching in this period."),
    ).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith("/timetables/sec1:validate", {
      academic_session_id: "sess1",
    });
  });

  it("reports a clean validation run", async () => {
    mockUsePermission.mockReturnValue(true);
    mockPost.mockResolvedValue({
      data: { conflicts: [] },
      meta: undefined,
      requestId: null,
      status: 200,
    });
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("button", { name: "Check for conflicts" }));

    expect(await screen.findByText("No conflicts found.")).toBeInTheDocument();
  });

  it("renders the conflict list a refused publish carries instead of swallowing the 422", async () => {
    mockUsePermission.mockReturnValue(true);
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/timetables/sec1:publish",
        details: [
          {
            field: "non_field",
            issue: "This timetable has unresolved hard conflicts and cannot be published.",
          },
        ],
        meta: {
          conflicts: [
            {
              type: "room_double_booked",
              severity: "hard",
              // Both sides of the clash. The server sends every slot involved,
              // and the panel has to keep all of them — highlighting one cell of
              // a double booking is worse than useless.
              slot_ids: ["slot1", "slot2"],
              message: "raw server text",
            },
          ],
        },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(
      await screen.findByText(
        "This timetable cannot be published until the blocking conflicts below are resolved.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText("This room is already in use in this period."),
    ).toBeInTheDocument();
    // And on the cell itself: the panel says what is wrong, the cell says
    // *where*. A finding that names a rendered slot must reach both, which is
    // why the assertions above are scoped rather than global.
    expect(screen.getAllByText("This room is already in use in this period.")).toHaveLength(2);
  });

  it("still says something when a refused publish named no conflict at all", async () => {
    mockUsePermission.mockReturnValue(true);
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "There is no draft timetable for this section to publish.",
        status: 422,
        url: "/timetables/sec1:publish",
        details: [
          { field: "non_field", issue: "There is no draft timetable for this section to publish." },
        ],
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/That action isn't allowed right now\./)).toBeInTheDocument();
  });

  it("reports a successful publish and still shows the soft findings it returned", async () => {
    mockUsePermission.mockReturnValue(true);
    mockPost.mockResolvedValue({
      data: {
        published: 32,
        superseded: 0,
        conflicts: [
          {
            type: "room_over_capacity",
            severity: "soft",
            slot_ids: ["slot1"],
            message: "This room seats 20; the section has 31 students.",
          },
        ],
      },
      meta: undefined,
      requestId: null,
      status: 200,
    });
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Published 32 periods.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText("This room is smaller than the section."),
    ).toBeInTheDocument();
  });

  it("hides both actions from a user who holds neither permission", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    await screen.findByText("Mathematics");
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for conflicts" })).not.toBeInTheDocument();
  });

  it("renders the error envelope instead of the grid when the list fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/timetable-slots",
        requestId: "req-2",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<WeekGridScreen />);
    await chooseSectionAndSession(user);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-2/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
