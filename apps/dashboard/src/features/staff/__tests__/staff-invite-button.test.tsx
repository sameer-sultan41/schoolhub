import type { AuthenticatedUser } from "@schoolhub/types";
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { StaffDetailRecord } from "@/services/modules/staff/staff-type";
import { buildUser, renderWithProviders } from "@/test-utils";

import { StaffInviteButton } from "../staff-invite-button";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { staff: { inviteStaff: jest.fn() } },
}));

const mockUseCurrentUser = jest.fn<{ data: AuthenticatedUser | undefined }, []>();
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const mockInviteStaff = Services.staff.inviteStaff as jest.MockedFunction<
  typeof Services.staff.inviteStaff
>;

function staffDetail(overrides: Partial<StaffDetailRecord> = {}): StaffDetailRecord {
  return {
    id: "st-1",
    user_id: null,
    employee_number: "EMP-001",
    first_name: "Ayesha",
    last_name: "Khan",
    gender: null,
    date_of_birth: null,
    photo_file_id: null,
    photo_url: null,
    staff_type: "teaching",
    campus_id: "c1",
    department_id: null,
    designation_id: null,
    reports_to_staff_id: null,
    employment_type: null,
    employment_status: "active",
    joining_date: "2020-01-01",
    email: "ayesha@example.com",
    phone: "+92000000000",
    national_id: null,
    public_bio: null,
    address: null,
    ...overrides,
  };
}

function renderButton(staff: StaffDetailRecord) {
  return renderWithProviders(<StaffInviteButton staff={staff} name="Ayesha Khan" />);
}

describe("StaffInviteButton", () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReturnValue({ data: buildUser(["staff.staff.update"]) });
    mockInviteStaff.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
  });

  it("is hidden without staff.staff.update", () => {
    mockUseCurrentUser.mockReturnValue({ data: buildUser(["staff.staff.view"]) });
    renderButton(staffDetail());

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["resigned", "retired", "terminated"])("is hidden for a %s staff member", (status) => {
    renderButton(staffDetail({ employment_status: status }));

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads Send invitation when there is no login account yet", () => {
    renderButton(staffDetail({ user_id: null }));

    expect(
      screen.getByRole("button", { name: "Send invitation — Ayesha Khan" }),
    ).toBeInTheDocument();
  });

  it("reads Resend invitation once an account is linked, which may still be pending", () => {
    renderButton(staffDetail({ user_id: "u-9" }));

    expect(
      screen.getByRole("button", { name: "Resend invitation — Ayesha Khan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sends a new link if they haven't set a password yet."),
    ).toBeInTheDocument();
  });

  it("sends the invite with an Idempotency-Key and confirms", async () => {
    mockInviteStaff.mockResolvedValue(staffDetail({ user_id: "u-9" }));
    renderButton(staffDetail());

    await userEvent.setup().click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Invitation sent to Ayesha Khan.");
    });
    expect(mockInviteStaff).toHaveBeenCalledWith("st-1", expect.any(String));
  });

  it.each([
    ["already_active", "This staff member has already set up their account."],
    [
      "email_in_use",
      "This email belongs to another account. Change the staff member's email first.",
    ],
  ])("explains a 409 %s", async (code, message) => {
    mockInviteStaff.mockRejectedValue(
      new ApiError({ code, message: "Refused.", status: 409, url: "/staff/st-1:invite" }),
    );
    renderButton(staffDetail({ user_id: "u-9" }));

    await userEvent.setup().click(screen.getByRole("button", { name: /resend invitation/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message);
    });
  });
});
