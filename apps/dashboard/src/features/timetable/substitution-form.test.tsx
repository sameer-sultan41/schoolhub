import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubstitutionForm } from "@/features/timetable/substitution-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 7" }] }),
}));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useSectionOptions: () => ({ data: [{ id: "sec1", name: "A", class_id: "class1" }] }),
  useSubjectOptions: () => ({ data: [{ id: "sub1", name: "Mathematics", code: "MATH" }] }),
  usePeriodOptions: () => ({ data: [{ id: "p1", name: "Period 1", sequence: 1 }] }),
  useTeachingStaffOptions: () => ({
    data: [
      { id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" },
      { id: "staff2", employee_number: "EMP-2", first_name: "Sana", last_name: "Iqbal" },
    ],
  }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

const PUBLISHED_SLOT = {
  id: "slot1",
  academic_session_id: "sess1",
  section_id: "sec1",
  day_of_week: 1,
  period_id: "p1",
  subject_id: "sub1",
  staff_id: "staff1",
  room_id: null,
  status: "published",
  effective_from: "2026-04-01",
  effective_to: null,
  notes: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

function page(items: unknown[]): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

/** Open the dialog and narrow down to one candidate period. 2026-09-08 is a
 * Tuesday, which is `day_of_week` 1 in the API's Monday-based numbering. */
async function openAndNarrow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Propose a substitution" }));
  await user.click(screen.getByRole("combobox", { name: "Academic session" }));
  await user.click(await screen.findByRole("option", { name: "2026-27" }));
  await user.click(screen.getByRole("combobox", { name: "Section" }));
  await user.click(await screen.findByRole("option", { name: "Grade 7 A" }));
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: "2026-09-08" } });
}

describe("SubstitutionForm", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue(page([PUBLISHED_SLOT]));
  });

  it("asks only for the section's published slots on that date's weekday", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        academic_session_id: "sess1",
        section_id: "sec1",
        status: "published",
        weekday: 1,
      });
    });
  });

  it("never offers a period that was superseded by a republish", async () => {
    // `status=published` and end-dated are not exclusive: a republish retires
    // the row it replaces rather than deleting it. Proposing cover against one
    // would be cover for a class that no longer meets.
    mockGet.mockResolvedValue(
      page([{ ...PUBLISHED_SLOT, id: "slot0", effective_to: "2026-08-31" }, PUBLISHED_SLOT]),
    );
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await user.click(screen.getByRole("combobox", { name: "Period" }));

    expect(await screen.findAllByRole("option", { name: /Period 1/ })).toHaveLength(1);
  });

  it("derives the absent teacher from the chosen period rather than asking for it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    expect(await screen.findByText("Pick a period first.")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: /Period 1/ }));

    expect(await screen.findByText("Bilal Ahmed")).toBeInTheDocument();
  });

  it("never offers the absent teacher as their own substitute", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: /Period 1/ }));
    await user.click(screen.getByRole("combobox", { name: "Covering teacher" }));

    expect(await screen.findByRole("option", { name: "Sana Iqbal" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Bilal Ahmed" })).not.toBeInTheDocument();
  });

  it("posts the proposal with the derived absent teacher and a null reason when blank", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: /Period 1/ }));
    await user.click(screen.getByRole("combobox", { name: "Covering teacher" }));
    await user.click(await screen.findByRole("option", { name: "Sana Iqbal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/teacher-substitutions", {
        timetable_slot_id: "slot1",
        date: "2026-09-08",
        absent_staff_id: "staff1",
        substitute_staff_id: "staff2",
        reason: null,
      });
    });
  });

  it("routes a server field error onto the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/teacher-substitutions",
        details: [
          {
            field: "substitute_staff_id",
            issue: "This teacher already has a class in that period.",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: /Period 1/ }));
    await user.click(screen.getByRole("combobox", { name: "Covering teacher" }));
    await user.click(await screen.findByRole("option", { name: "Sana Iqbal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This teacher already has a class in that period."),
    ).toBeInTheDocument();
  });

  it("shows the absent-teacher message in the root alert, since it has no input", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/teacher-substitutions",
        details: [
          {
            field: "absent_staff_id",
            issue: "This teacher is not the one scheduled for that slot.",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: /Period 1/ }));
    await user.click(screen.getByRole("combobox", { name: "Covering teacher" }));
    await user.click(await screen.findByRole("option", { name: "Sana Iqbal" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This teacher is not the one scheduled for that slot.",
    );
  });

  it("cannot be submitted before a period fixes the absent teacher", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionForm />);
    await openAndNarrow(user);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
