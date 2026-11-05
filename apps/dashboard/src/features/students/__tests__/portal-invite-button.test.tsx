import type { AuthenticatedUser } from "@schoolhub/types";
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { PortalStatus } from "@/services/modules/students/students-type";
import { buildUser, renderWithProviders } from "@/test-utils";

import { PortalInviteButton } from "../portal-invite-button";
import type { PortalInviteTarget } from "../use-portal-invite";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: { inviteGuardian: jest.fn() },
    students: { inviteStudent: jest.fn() },
  },
}));

const mockUseCurrentUser = jest.fn<{ data: AuthenticatedUser | undefined }, []>();
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const mockInviteGuardian = Services.guardians.inviteGuardian as jest.MockedFunction<
  typeof Services.guardians.inviteGuardian
>;
const mockInviteStudent = Services.students.inviteStudent as jest.MockedFunction<
  typeof Services.students.inviteStudent
>;

const INVITER = buildUser(["students.portal-account.invite"]);
const GUARDIAN: PortalInviteTarget = { kind: "guardian", id: "g1", name: "Bilal Ahmed" };
const STUDENT: PortalInviteTarget = { kind: "student", id: "s1", name: "Aisha Khan" };

function renderButton(target: PortalInviteTarget, portalStatus: PortalStatus) {
  return renderWithProviders(<PortalInviteButton target={target} portalStatus={portalStatus} />);
}

function conflict(code: string) {
  return new ApiError({ code, message: "Refused.", status: 409, url: "/guardians/g1:invite" });
}

describe("PortalInviteButton", () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReturnValue({ data: INVITER });
    mockInviteGuardian.mockReset();
    mockInviteStudent.mockReset();
    (toast.success as jest.Mock).mockReset();
    (toast.error as jest.Mock).mockReset();
  });

  it("is hidden without students.portal-account.invite", () => {
    mockUseCurrentUser.mockReturnValue({ data: buildUser(["students.guardian.update"]) });
    renderButton(GUARDIAN, "none");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each<[PortalStatus, string]>([
    ["none", "Invite to portal"],
    ["inactive", "Invite to portal"],
    ["invited", "Resend invitation"],
    ["expired", "Resend invitation"],
    ["send_failed", "Resend invitation"],
  ])("reads the right action for %s", (status, label) => {
    renderButton(GUARDIAN, status);

    expect(screen.getByRole("button", { name: `${label} — Bilal Ahmed` })).toBeInTheDocument();
  });

  it("shows nothing once the account is active", () => {
    renderButton(GUARDIAN, "active");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("invites a guardian in one click with an Idempotency-Key, and confirms", async () => {
    mockInviteGuardian.mockResolvedValue({ portal_status: "invited" });
    renderButton(GUARDIAN, "none");

    await userEvent.setup().click(screen.getByRole("button", { name: /invite to portal/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Invitation sent to Bilal Ahmed.");
    });
    expect(mockInviteGuardian).toHaveBeenCalledWith("g1", expect.any(String));
    expect(mockInviteGuardian.mock.calls[0]?.[1]).not.toBe("");
  });

  it.each([
    ["email_in_use", "That email already belongs to another account. Use a different address."],
    ["portal_disabled", "The parent portal isn't enabled for your school."],
    ["not_eligible", "This person can't be given portal access right now."],
    ["already_active", "This person already has an active account."],
  ])("explains a 409 %s in the school's language", async (code, message) => {
    mockInviteGuardian.mockRejectedValue(conflict(code));
    renderButton(GUARDIAN, "none");

    await userEvent.setup().click(screen.getByRole("button", { name: /invite to portal/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message);
    });
  });

  it("shows the API's reason for a guardian with no email on file", async () => {
    mockInviteGuardian.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid input.",
        status: 400,
        url: "/guardians/g1:invite",
        details: [{ field: "email", issue: "An email address is required to invite this person." }],
      }),
    );
    renderButton(GUARDIAN, "none");

    await userEvent.setup().click(screen.getByRole("button", { name: /invite to portal/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "An email address is required to invite this person.",
      );
    });
  });

  it("uses a new Idempotency-Key after a definite answer, so a resend is no replay", async () => {
    mockInviteGuardian.mockResolvedValue({ portal_status: "invited" });
    renderButton(GUARDIAN, "expired");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /resend invitation/i }));
    await waitFor(() => {
      expect(mockInviteGuardian).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole("button", { name: /resend invitation/i }));
    await waitFor(() => {
      expect(mockInviteGuardian).toHaveBeenCalledTimes(2);
    });

    expect(mockInviteGuardian.mock.calls[0]?.[1]).not.toBe(mockInviteGuardian.mock.calls[1]?.[1]);
  });

  it("asks for a student's email, then sends it with the invite", async () => {
    mockInviteStudent.mockResolvedValue({ portal_status: "invited" });
    renderButton(STUDENT, "none");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /invite to portal/i }));
    const dialog = await screen.findByRole("dialog", { name: "Invite Aisha Khan to the portal" });
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mockInviteStudent).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/^student's email/i), "aisha@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockInviteStudent).toHaveBeenCalledWith("s1", "aisha@example.com", expect.any(String));
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the student dialog open with the 409's reason", async () => {
    mockInviteStudent.mockRejectedValue(conflict("email_in_use"));
    renderButton(STUDENT, "none");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /invite to portal/i }));
    await user.type(await screen.findByLabelText(/^student's email/i), "parent@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(
      await screen.findByText(
        "That email already belongs to another account. Use a different address.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says an inactive account uses the typed email only if nobody ever signed in", async () => {
    renderButton(STUDENT, "inactive");

    await userEvent.setup().click(screen.getByRole("button", { name: /invite to portal/i }));

    expect(
      await screen.findByText(
        "If the student has never signed in, the invitation goes to the address entered here. If they have, it goes to their account's existing address.",
      ),
    ).toBeInTheDocument();
  });

  it.each<PortalStatus>(["invited", "expired", "send_failed"])(
    "tells the admin a %s invite is re-sent to the address entered",
    async (portalStatus) => {
      renderButton(STUDENT, portalStatus);

      await userEvent.setup().click(screen.getByRole("button", { name: /resend invitation/i }));

      expect(
        await screen.findByText(
          "The invitation is sent again, to the address entered here. Use this to correct a mistyped address.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("sends a resend to the corrected address typed in the dialog", async () => {
    mockInviteStudent.mockResolvedValue({ portal_status: "invited" });
    renderButton(STUDENT, "send_failed");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /resend invitation/i }));
    await user.type(await screen.findByLabelText(/^student's email/i), "fixed@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    await waitFor(() => {
      expect(mockInviteStudent).toHaveBeenCalledWith("s1", "fixed@example.com", expect.any(String));
    });
  });
});
