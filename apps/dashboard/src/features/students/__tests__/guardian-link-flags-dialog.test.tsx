import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianLinkRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { GuardianLinkFlagsDialog } from "../guardian-link-flags-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { guardians: { updateGuardianLink: jest.fn() } },
}));

const mockUpdateGuardianLink = Services.guardians.updateGuardianLink as jest.MockedFunction<
  typeof Services.guardians.updateGuardianLink
>;

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

describe("GuardianLinkFlagsDialog", () => {
  const onOpenChange = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    mockUpdateGuardianLink.mockReset();
    onOpenChange.mockReset();
    onSaved.mockReset();
  });

  it("pre-fills from the given link and PATCHes the full current flag set, including the one just toggled", async () => {
    // This dialog has no partial-PATCH support — the form always submits all four flags
    // together (see `toUpdateGuardianLinkInput` below), so this asserts the exact body
    // rather than a loose `objectContaining`, which would also pass a broken partial-send.
    mockUpdateGuardianLink.mockResolvedValue(linkRecord({ is_fee_responsible: true }));

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /fee responsible/i })).not.toBeChecked();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /fee responsible/i }));
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalledWith("link-1", {
        relationship: linkRecord().relationship,
        isFeeResponsible: true,
        canPickUp: true,
        receivesCommunications: true,
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("never sends isPrimary — this dialog cannot promote or demote", async () => {
    mockUpdateGuardianLink.mockResolvedValue(linkRecord());

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByText(/primary/i)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalled();
    });
    const [, body] = mockUpdateGuardianLink.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("isPrimary");
  });

  it("never shows or sends hasPortalAccess — out of spec for this edit dialog (round-6 review)", async () => {
    mockUpdateGuardianLink.mockResolvedValue(linkRecord());

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByText(/portal access/i)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalled();
    });
    const [, body] = mockUpdateGuardianLink.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("hasPortalAccess");
  });

  it("shows a server field error for a flag checkbox instead of failing silently", async () => {
    // Regression for a missing <FormMessage /> on the three flag checkboxes — the same
    // class of bug already fixed for guardian-form-dialog's alt_phone,
    // emergency-contacts-tab's alt_phone/notes, and document-upload-dialog's
    // expires_at/notes: without it, applyServerFieldErrors still calls
    // form.setError("is_fee_responsible", ...) and marks the field as matched
    // (suppressing the dialog-level fallback alert too), but nothing was rendered to
    // show it — a save that silently appeared to do nothing.
    mockUpdateGuardianLink.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Validation failed.",
        status: 422,
        url: "/student-guardians/link-1",
        details: [{ field: "is_fee_responsible", issue: "This flag conflicts with another link." }],
      }),
    );

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("This flag conflicts with another link.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
