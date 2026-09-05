import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodForm } from "@/features/timetable/period-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useCampusOptions: () => ({ data: [{ id: "campus1", name: "Main Campus", code: "MAIN" }] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

const EXISTING = {
  id: "p1",
  campus_id: "campus1",
  name: "Period 1",
  sequence: 1,
  start_time: "08:00:00",
  end_time: "08:40:00",
  is_break: false,
  weekdays: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

/** FormLabel's `required` appends an aria-hidden asterisk, so the accessible name
 * is "Name *" — every lookup for a required field has to be a regex. */
async function fillNewPeriod(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add period" }));
  await user.type(screen.getByLabelText(/^Name/), "Period 3");
  await user.type(screen.getByLabelText(/^Daily order/), "3");
  // fireEvent.change, not user.type: an <input type="time"> in jsdom does not
  // accept per-character typing the way a text box does.
  fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: "10:00" } });
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: "10:40" } });
}

describe("PeriodForm", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("creates a tenant-wide period, sending null for the campus and the weekdays", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await fillNewPeriod(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/periods", {
        campus_id: null,
        name: "Period 3",
        sequence: 3,
        start_time: "10:00",
        end_time: "10:40",
        is_break: false,
        weekdays: null,
      });
    });
  });

  it("sends the ticked weekdays in order when the period only runs some days", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await fillNewPeriod(user);
    await user.click(screen.getByRole("checkbox", { name: "Friday" }));
    await user.click(screen.getByRole("checkbox", { name: "Monday" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ weekdays: [0, 4] });
    });
  });

  it("hides the weekday picker for a break, which is never schedulable", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await user.click(screen.getByRole("button", { name: "Add period" }));
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "This period is a break" }));

    expect(screen.queryByRole("checkbox", { name: "Monday" })).not.toBeInTheDocument();
  });

  it("patches an existing period and trims HH:MM:SS down for the time input", async () => {
    mockPatch.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm period={EXISTING} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText(/^Starts/)).toHaveValue("08:00");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/periods/p1", {
        campus_id: "campus1",
        name: "Period 1",
        sequence: 1,
        start_time: "08:00",
        end_time: "08:40",
        is_break: false,
        weekdays: null,
      });
    });
  });

  it("refuses an end time before the start time without asking the server", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await user.click(screen.getByRole("button", { name: "Add period" }));
    await user.type(screen.getByLabelText(/^Name/), "Period 3");
    await user.type(screen.getByLabelText(/^Daily order/), "3");
    fireEvent.change(screen.getByLabelText(/^Starts/), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: "10:00" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("The end time must be after the start time."),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("routes the overlap message onto the start-time field", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "unprocessable",
        status: 422,
        url: "/periods",
        details: [
          {
            field: "start_time",
            issue: "This overlaps 'Recess' (10:30:00-10:50:00).",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await fillNewPeriod(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This overlaps 'Recess' (10:30:00-10:50:00)."),
    ).toBeInTheDocument();
  });

  it("renders the envelope for a 409 the form has no field for", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "That daily order is already used on this campus.",
        status: 409,
        url: "/periods",
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PeriodForm />);

    await fillNewPeriod(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    // A 409 is not a validation failure, so it renders through the envelope.
    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });
});
