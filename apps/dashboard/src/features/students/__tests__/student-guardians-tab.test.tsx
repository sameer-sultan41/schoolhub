import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { GuardianLinkRecord, GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentGuardiansTab } from "../student-guardians-tab";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: {
      fetchGuardianLinks: jest.fn(),
      fetchGuardianById: jest.fn(),
      updateGuardianLink: jest.fn(),
      updateGuardian: jest.fn(),
      searchGuardians: jest.fn(),
      createGuardian: jest.fn(),
      linkGuardianToStudent: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockFetchGuardianLinks = Services.guardians.fetchGuardianLinks as jest.MockedFunction<
  typeof Services.guardians.fetchGuardianLinks
>;
const mockFetchGuardianById = Services.guardians.fetchGuardianById as jest.MockedFunction<
  typeof Services.guardians.fetchGuardianById
>;
const mockUpdateGuardianLink = Services.guardians.updateGuardianLink as jest.MockedFunction<
  typeof Services.guardians.updateGuardianLink
>;
const mockCreateGuardian = Services.guardians.createGuardian as jest.MockedFunction<
  typeof Services.guardians.createGuardian
>;
const mockLinkGuardianToStudent = Services.guardians.linkGuardianToStudent as jest.MockedFunction<
  typeof Services.guardians.linkGuardianToStudent
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function linkRecord(overrides: Partial<GuardianLinkRecord> = {}): GuardianLinkRecord {
  return {
    id: "link-1",
    student_id: "student-1",
    guardian_id: "g1",
    relationship: "father",
    is_primary: false,
    is_fee_responsible: false,
    can_pick_up: true,
    receives_communications: true,
    has_portal_access: true,
    access_revoked_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function guardianRecord(overrides: Partial<GuardianRecord> = {}): GuardianRecord {
  return {
    id: "g1",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentGuardiansTab", () => {
  beforeEach(() => {
    mockFetchGuardianLinks.mockReset();
    mockFetchGuardianById.mockReset();
    mockUpdateGuardianLink.mockReset();
    mockCreateGuardian.mockReset();
    mockLinkGuardianToStudent.mockReset();
    mockToastError.mockReset();
  });

  it("shows empty copy when the student has no guardians linked", async () => {
    mockFetchGuardianLinks.mockResolvedValue([]);

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/no guardians linked yet/i)).toBeInTheDocument();
  });

  it("shows a load-error state, distinct from the empty state, when the links fetch fails", async () => {
    mockFetchGuardianLinks.mockRejectedValue(new Error("network down"));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/couldn't load this student's guardians/i)).toBeInTheDocument();
    expect(screen.queryByText(/no guardians linked yet/i)).not.toBeInTheDocument();
  });

  it("lists a linked guardian with their relationship and flags, resolved through Services.guardians.fetchGuardianById", async () => {
    mockFetchGuardianLinks.mockResolvedValue([
      linkRecord({ is_fee_responsible: true, can_pick_up: true }),
    ]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/father/i)).toBeInTheDocument();
    expect(await screen.findByText(/ayesha raza/i)).toBeInTheDocument();
    expect(mockFetchGuardianById).toHaveBeenCalledWith("g1");
  });

  it("shows a per-row load-error with retry when a guardian lookup fails, not a stuck placeholder", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord()]);
    mockFetchGuardianById.mockRejectedValueOnce(new Error("lookup failed"));
    mockFetchGuardianById.mockResolvedValueOnce(guardianRecord());

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/couldn't load this guardian/i)).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();

    // The real retry-button copy: `common.retry` is "Try again", not "Retry".
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(mockFetchGuardianById).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/ayesha raza/i)).toBeInTheDocument();
  });

  it("promotes a non-primary link to primary with one click, no dialog", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord({ is_primary: false })]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());
    mockUpdateGuardianLink.mockResolvedValue(linkRecord({ is_primary: true }));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    const button = await screen.findByRole("button", { name: /make primary/i });
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalledWith("link-1", { isPrimary: true });
    });
  });

  it("shows a toast and leaves the row unchanged when promoting to primary fails", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord({ is_primary: false })]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());
    mockUpdateGuardianLink.mockRejectedValue(new Error("server exploded"));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /make primary/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: /make primary/i })).toBeInTheDocument();
  });

  it("resumes the link step for an already-created guardian after the picker is cancelled before linking", async () => {
    // Regression (round-8 review, Medium #1): once a guardian is created via the
    // picker's "Create new" tab, cancelling the dialog before completing the link step
    // used to unmount GuardianPickerDialog entirely, losing the just-created guardian's
    // id. Guardians have no delete endpoint, and GuardianViewSet only surfaces a
    // guardian with at least one student link to a campus-scoped searcher
    // (apps/api/apps/student_management/views.py), so that guardian became permanently
    // unfindable — the next "Create new" attempt would silently create a duplicate
    // record for the same person. The fix lifts the just-created guardian's id into
    // this component's own state, so reopening the picker resumes straight at the link
    // step for that SAME guardian instead of restarting at the choose step.
    mockFetchGuardianLinks.mockResolvedValue([]);
    mockCreateGuardian.mockResolvedValue(
      guardianRecord({ id: "g9", first_name: "Bilal", last_name: "Khan" }),
    );
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-9" } as never);
    const user = userEvent.setup();

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    await user.click(await screen.findByRole("button", { name: /link guardian/i }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("tab", { name: /create new/i }));
    await user.type(await within(dialog).findByLabelText(/first name/i), "Bilal");
    await user.type(within(dialog).getByLabelText(/last name/i), "Khan");
    await user.type(within(dialog).getByLabelText(/^phone$/i), "0300-1111111");
    await user.click(within(dialog).getByRole("button", { name: /create guardian/i }));

    expect(await within(dialog).findByText("Bilal Khan")).toBeInTheDocument();
    expect(mockCreateGuardian).toHaveBeenCalledTimes(1);

    // Cancel before linking — the whole dialog unmounts.
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Reopen: must resume straight at the link step for the SAME guardian, never back
    // at "choose" (which would make "Create new" reachable again).
    await user.click(screen.getByRole("button", { name: /link guardian/i }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bilal Khan")).toBeInTheDocument();
    expect(within(dialog).queryByRole("tab", { name: /create new/i })).not.toBeInTheDocument();
    expect(mockCreateGuardian).toHaveBeenCalledTimes(1);

    // Completing the link now must reuse the already-created guardian's id.
    await user.click(within(dialog).getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^father$/i }));
    await user.click(within(dialog).getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ guardianId: "g9", relationship: "father" }),
      );
    });
    expect(mockCreateGuardian).toHaveBeenCalledTimes(1);
  });

  it("hides every action for a caller without create/update permission", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord()]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());

    renderWithProviders(
      <StudentGuardiansTab studentId="student-1" canCreate={false} canUpdate={false} />,
    );

    await screen.findByText(/father/i);
    expect(screen.queryByRole("button", { name: /link guardian/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit link/i })).not.toBeInTheDocument();
  });
});
