import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { GuardianFormDialog } from "../guardian-form-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: { updateGuardian: jest.fn() },
    files: { uploadFile: jest.fn() },
  },
}));

const mockUpdateGuardian = Services.guardians.updateGuardian as jest.MockedFunction<
  typeof Services.guardians.updateGuardian
>;

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

describe("GuardianFormDialog", () => {
  const onOpenChange = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    mockUpdateGuardian.mockReset();
    onOpenChange.mockReset();
    onSaved.mockReset();
  });

  it("pre-fills from the given record and PATCHes only on submit", async () => {
    const record = guardianRecord({ alt_phone: "0300-1111111" });

    renderWithProviders(
      <GuardianFormDialog open guardian={record} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    expect(screen.getByDisplayValue("Ayesha")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0300-1111111")).toBeInTheDocument();

    mockUpdateGuardian.mockResolvedValue(guardianRecord({ phone: "0300-9999999" }));
    const phoneInput = screen.getByLabelText(/^phone$/i);
    await userEvent.setup().clear(phoneInput);
    await userEvent.setup().type(phoneInput, "0300-9999999");
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardian).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ phone: "0300-9999999" }),
      );
    });
  });

  it("blocks submission when a required field is cleared", async () => {
    const record = guardianRecord();

    renderWithProviders(
      <GuardianFormDialog open guardian={record} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    await userEvent.setup().clear(screen.getByLabelText(/last name/i));
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    expect(mockUpdateGuardian).not.toHaveBeenCalled();
  });

  it("clearing an optional field sends an explicit null, not an omission", async () => {
    const record = guardianRecord({ alt_phone: "0300-1111111" });
    mockUpdateGuardian.mockResolvedValue(guardianRecord({ alt_phone: null }));

    renderWithProviders(
      <GuardianFormDialog open guardian={record} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    await userEvent.setup().clear(screen.getByLabelText(/alternate phone/i));
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    // `formValuesToUpdateGuardianInput` (guardians-helper.ts) maps a cleared field to an
    // explicit `null`, not a bare `""` — `toUpdateGuardianBody`'s `!== undefined` gate
    // only forwards a clear when it actually sees `null` (round-6 review finding, see
    // that helper's own comment).
    await waitFor(() => {
      expect(mockUpdateGuardian).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ altPhone: null }),
      );
    });
  });

  it("shows the server's real error when saving fails", async () => {
    const record = guardianRecord();
    mockUpdateGuardian.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Validation failed.",
        status: 422,
        url: "/guardians/g1",
        details: [{ field: "phone", issue: "Enter a valid phone number." }],
      }),
    );

    renderWithProviders(
      <GuardianFormDialog open guardian={record} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const phoneInput = screen.getByLabelText(/^phone$/i);
    await userEvent.setup().clear(phoneInput);
    await userEvent.setup().type(phoneInput, "bad");
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
