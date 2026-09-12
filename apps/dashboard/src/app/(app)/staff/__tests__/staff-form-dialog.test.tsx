import type { ReactNode } from "react";
import { ApiError } from "@schoolhub/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

import { Services } from "@/services";
import type { StaffDetailRecord } from "@/services/modules/dashboard/dashboard-service";
import { renderWithProviders } from "@/test-utils";

import { StaffFormDialog } from "../staff-form-dialog";

jest.mock("@/services", () => ({
  Services: {
    dashboard: {
      fetchCampuses: jest.fn(),
      fetchDepartments: jest.fn(),
      fetchDesignations: jest.fn(),
      fetchStaffDirectory: jest.fn(),
      fetchStaffById: jest.fn(),
      createStaff: jest.fn(),
      updateStaff: jest.fn(),
    },
    files: {
      uploadFile: jest.fn(),
    },
  },
}));

// The component calls `toast.success(...)` directly (never the callable `toast(...)`
// itself), matching staff-directory-table.test.tsx's own reasoning for mocking only
// what's actually used.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchDepartments = Services.dashboard.fetchDepartments as jest.MockedFunction<
  typeof Services.dashboard.fetchDepartments
>;
const mockFetchDesignations = Services.dashboard.fetchDesignations as jest.MockedFunction<
  typeof Services.dashboard.fetchDesignations
>;
const mockFetchStaffDirectory = Services.dashboard.fetchStaffDirectory as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffDirectory
>;
const mockFetchStaffById = Services.dashboard.fetchStaffById as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffById
>;
const mockCreateStaff = Services.dashboard.createStaff as jest.MockedFunction<
  typeof Services.dashboard.createStaff
>;
const mockUpdateStaff = Services.dashboard.updateStaff as jest.MockedFunction<
  typeof Services.dashboard.updateStaff
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

/** Every reference-data query the dialog fires on open, given sane empty-ish defaults —
 * each test overrides only the ones it actually cares about. */
function mockReferenceData() {
  mockFetchCampuses.mockResolvedValue([{ id: "c1", name: "Main Campus" }]);
  mockFetchDepartments.mockResolvedValue([]);
  mockFetchDesignations.mockResolvedValue([]);
  mockFetchStaffDirectory.mockResolvedValue([]);
}

function detailRecord(overrides: Partial<StaffDetailRecord> = {}): StaffDetailRecord {
  return {
    id: "st-1",
    employee_number: "EMP-001",
    first_name: "Ayesha",
    last_name: "Khan",
    gender: null,
    date_of_birth: null,
    photo_file_id: null,
    staff_type: "teaching",
    campus_id: "c1",
    department_id: null,
    designation_id: null,
    reports_to_staff_id: null,
    employment_type: null,
    employment_status: "active",
    joining_date: "2020-01-01",
    email: null,
    phone: "+92000000000",
    national_id: null,
    public_bio: null,
    address: null,
    ...overrides,
  };
}

/** Radix's Select renders its trigger with `role="combobox"` (accessible name comes from
 * the associated FormLabel via `htmlFor`/`id`, same wiring FormControl gives every other
 * field) and each option with `role="option"` inside a portal — `screen` already searches
 * the whole document, portal included. The campus/department/designation/reports-to
 * selects start out `disabled` while their own `useQuery` is still pending (the dialog's
 * documented "Loading…" placeholder state) — waiting for the trigger to become enabled
 * before clicking it avoids a click that silently does nothing. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, label: RegExp, option: RegExp) {
  const trigger = await waitFor(() => {
    const element = screen.getByRole("combobox", { name: label });
    expect(element).not.toBeDisabled();
    return element;
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** `<input type="date">` — `userEvent.type` simulates real per-segment keyboard entry
 * that jsdom's date input does not actually implement, so the value is set directly via
 * a change event instead, same as this suite treats the file input's change event. */
function setDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

async function fillRequiredCreateFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^first name$/i), "Ayesha");
  await user.type(screen.getByLabelText(/^last name$/i), "Khan");
  await chooseOption(user, /^staff type$/i, /^teaching$/i);
  await chooseOption(user, /^campus$/i, /^main campus$/i);
  setDate(screen.getByLabelText(/^joining date$/i), "2026-09-01");
  await user.type(screen.getByLabelText(/^phone$/i), "+92-300-0000000");
}

describe("StaffFormDialog", () => {
  beforeEach(() => {
    mockFetchCampuses.mockReset();
    mockFetchDepartments.mockReset();
    mockFetchDesignations.mockReset();
    mockFetchStaffDirectory.mockReset();
    mockFetchStaffById.mockReset();
    mockCreateStaff.mockReset();
    mockUpdateStaff.mockReset();
    mockToastSuccess.mockReset();
  });

  describe("create mode", () => {
    it("submits createStaff with the filled-in required fields and nothing else", async () => {
      mockReferenceData();
      mockCreateStaff.mockResolvedValue({
        id: "st-new",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: null,
        department_name: null,
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-01T00:00:00Z",
      });
      const onOpenChange = jest.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="create" onOpenChange={onOpenChange} />,
      );
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.click(screen.getByRole("button", { name: /add member/i }));

      await waitFor(() => {
        expect(mockCreateStaff).toHaveBeenCalledWith({
          campusId: "c1",
          joiningDate: "2026-09-01",
          firstName: "Ayesha",
          lastName: "Khan",
          staffType: "teaching",
          phone: "+92-300-0000000",
          departmentId: undefined,
          designationId: undefined,
          reportsToStaffId: undefined,
          photoFileId: undefined,
          gender: undefined,
          dateOfBirth: undefined,
          employmentType: undefined,
          email: undefined,
          nationalId: undefined,
          publicBio: undefined,
          address: undefined,
        });
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockToastSuccess).toHaveBeenCalledWith("Staff member added");
    });

    it("blocks submission and never calls createStaff when a required field is left empty", async () => {
      mockReferenceData();
      const onOpenChange = jest.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="create" onOpenChange={onOpenChange} />,
      );
      await screen.findByRole("combobox", { name: /^campus$/i });

      // Everything except `last_name` is filled in.
      await user.type(screen.getByLabelText(/^first name$/i), "Ayesha");
      await chooseOption(user, /^staff type$/i, /^teaching$/i);
      await chooseOption(user, /^campus$/i, /^main campus$/i);
      setDate(screen.getByLabelText(/^joining date$/i), "2026-09-01");
      await user.type(screen.getByLabelText(/^phone$/i), "+92-300-0000000");
      await user.click(screen.getByRole("button", { name: /add member/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/^last name$/i)).toHaveAttribute("aria-invalid", "true");
      });
      expect(mockCreateStaff).not.toHaveBeenCalled();
    });
  });

  describe("edit mode", () => {
    it("pre-fills from fetchStaffById and submits updateStaff against that staff's id", async () => {
      mockReferenceData();
      mockFetchStaffById.mockResolvedValue(detailRecord());
      mockUpdateStaff.mockResolvedValue({
        id: "st-1",
        first_name: "Ayesha",
        last_name: "Khan",
        designation_name: null,
        department_name: null,
        campus_name: "Main Campus",
        staff_type: "teaching",
        employment_status: "active",
        updated_at: "2026-09-02T00:00:00Z",
      });
      const onOpenChange = jest.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={onOpenChange} />,
      );

      // The dialog shows a loading placeholder (gated on `staffDetailQuery.isPending`)
      // until the detail record resolves and the form is populated via RHF's `values`.
      expect(await screen.findByDisplayValue("Ayesha")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Khan")).toBeInTheDocument();
      expect(screen.getByDisplayValue("+92000000000")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockUpdateStaff).toHaveBeenCalledWith("st-1", {
          campusId: "c1",
          joiningDate: "2020-01-01",
          firstName: "Ayesha",
          lastName: "Khan",
          staffType: "teaching",
          phone: "+92000000000",
          departmentId: undefined,
          designationId: undefined,
          reportsToStaffId: undefined,
          photoFileId: undefined,
          gender: undefined,
          dateOfBirth: undefined,
          employmentType: undefined,
          email: undefined,
          nationalId: undefined,
          publicBio: undefined,
          address: undefined,
        });
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockToastSuccess).toHaveBeenCalledWith("Staff member updated");
    });

    it("reopening Edit for the SAME staff member after closing shows their real data, not a blank form", async () => {
      // Regression test for a bug where react-hook-form's `values` prop (deep-equality
      // cached against RHF's own internal ref) silently skipped re-applying the exact
      // same detail object on a second open, leaving the form on EMPTY_DEFAULTS. The fix
      // replaced `values` with an explicit `form.reset(...)` in a `useEffect` keyed on
      // `open`/`mode`/the query data, which has no such cache.
      //
      // Deliberately not `renderWithProviders` here: reproducing the bug requires the
      // SAME `StaffFormDialog` instance (and its one `useForm` call) to survive the
      // close/reopen via prop changes, not a fresh mount/unmount — a remount would throw
      // away RHF's internal cache and could never have exhibited the bug in the first
      // place. `renderWithProviders` doesn't expose the `QueryClientProvider` it wraps
      // ui in, so `rerender` couldn't reuse it; building the same wrapper locally and
      // passing it via RTL's `wrapper` option lets `rerender` re-apply it every time.
      mockReferenceData();
      mockFetchStaffById.mockResolvedValue(detailRecord());
      const onOpenChange = jest.fn();
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      }

      const { rerender } = render(
        <StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={onOpenChange} />,
        { wrapper: Wrapper },
      );

      // First open: the form populates from the fetched detail record.
      expect(await screen.findByDisplayValue("Ayesha")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Khan")).toBeInTheDocument();

      // Close the dialog — this drives the existing close-effect's
      // `form.reset(EMPTY_DEFAULTS)`, and `staffDetailQuery` disables (staffId irrelevant
      // while `open` is false).
      rerender(<StaffFormDialog open={false} mode="edit" staffId="st-1" onOpenChange={onOpenChange} />);
      await waitFor(() => {
        expect(screen.queryByDisplayValue("Ayesha")).not.toBeInTheDocument();
      });

      // Reopen Edit for the exact same staff id — `fetchStaffById` resolves to a new but
      // deep-equal detail object, which is exactly the case RHF's `values` prop used to
      // treat as "already applied" and skip.
      mockFetchStaffById.mockResolvedValue(detailRecord());
      rerender(<StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={onOpenChange} />);

      expect(await screen.findByDisplayValue("Ayesha")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Khan")).toBeInTheDocument();
      expect(screen.getByDisplayValue("+92000000000")).toBeInTheDocument();
    });

    it("excludes the staff member being edited from their own 'Reports to' options", async () => {
      mockFetchCampuses.mockResolvedValue([{ id: "c1", name: "Main Campus" }]);
      mockFetchDepartments.mockResolvedValue([]);
      mockFetchDesignations.mockResolvedValue([]);
      mockFetchStaffDirectory.mockResolvedValue([
        {
          id: "st-1",
          first_name: "Ayesha",
          last_name: "Khan",
          designation_name: null,
          department_name: null,
          campus_name: "Main Campus",
          staff_type: "teaching",
          employment_status: "active",
          updated_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "st-2",
          first_name: "Bilal",
          last_name: "Ahmed",
          designation_name: null,
          department_name: null,
          campus_name: "Main Campus",
          staff_type: "teaching",
          employment_status: "active",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ]);
      mockFetchStaffById.mockResolvedValue(detailRecord());
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="edit" staffId="st-1" onOpenChange={jest.fn()} />,
      );
      await screen.findByDisplayValue("Ayesha");

      const reportsToTrigger = await waitFor(() => {
        const element = screen.getByRole("combobox", { name: /^reports to$/i });
        expect(element).not.toBeDisabled();
        return element;
      });
      await user.click(reportsToTrigger);
      expect(await screen.findByRole("option", { name: /bilal ahmed/i })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /ayesha khan/i })).not.toBeInTheDocument();
    });
  });

  describe("server-side field errors", () => {
    it("maps an ApiError's field details onto the matching form fields", async () => {
      mockReferenceData();
      mockCreateStaff.mockRejectedValue(
        new ApiError({
          code: "validation_error",
          message: "Invalid",
          status: 422,
          url: "/staff",
          details: [{ field: "national_id", issue: "This national ID is already in use." }],
        }),
      );
      const onOpenChange = jest.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="create" onOpenChange={onOpenChange} />,
      );
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.type(screen.getByLabelText(/^national id$/i), "12345");
      await user.click(screen.getByRole("button", { name: /add member/i }));

      expect(
        await screen.findByText("This national ID is already in use."),
      ).toBeInTheDocument();
      // A mapped field error has somewhere to show already (its own FormMessage) — the
      // generic top-of-form fallback must not also render the same failure a second time.
      expect(screen.queryByText("Invalid")).not.toBeInTheDocument();
      // A failed submit must not close the dialog or report success.
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("shows a generic fallback alert for an error this form has no field to display", async () => {
      mockReferenceData();
      mockCreateStaff.mockRejectedValue(
        new ApiError({
          code: "server_error",
          message: "Something went wrong on our side. The team has been notified.",
          status: 500,
          url: "/staff",
        }),
      );
      const onOpenChange = jest.fn();
      const user = userEvent.setup();

      renderWithProviders(
        <StaffFormDialog open mode="create" onOpenChange={onOpenChange} />,
      );
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.click(screen.getByRole("button", { name: /add member/i }));

      expect(
        await screen.findByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });
});
