import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { EmergencyContactRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentEmergencyContactsTab } from "../student-emergency-contacts-tab";

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchEmergencyContacts: jest.fn(),
      addEmergencyContact: jest.fn(),
    },
  },
}));

const mockFetchEmergencyContacts = Services.students.fetchEmergencyContacts as jest.MockedFunction<
  typeof Services.students.fetchEmergencyContacts
>;
const mockAddEmergencyContact = Services.students.addEmergencyContact as jest.MockedFunction<
  typeof Services.students.addEmergencyContact
>;

function contactRecord(overrides: Partial<EmergencyContactRecord> = {}): EmergencyContactRecord {
  return {
    id: "c1",
    student_id: "student-1",
    name: "Hamza Raza",
    relationship: "Uncle",
    phone: "0300-0000000",
    alt_phone: null,
    priority: 1,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentEmergencyContactsTab", () => {
  beforeEach(() => {
    mockFetchEmergencyContacts.mockReset();
    mockAddEmergencyContact.mockReset();
  });

  it("shows empty copy when there are no contacts yet", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    expect(await screen.findByText(/no emergency contacts added yet/i)).toBeInTheDocument();
  });

  it("lists contacts ordered by priority with no edit or delete control", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([contactRecord()]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await screen.findByText("Hamza Raza");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("adds a contact, defaulting priority to one past the current count", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([contactRecord()]);
    mockAddEmergencyContact.mockResolvedValue(contactRecord({ id: "c2", priority: 2 }));
    const user = userEvent.setup();

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await user.click(await screen.findByRole("button", { name: /add contact/i }));
    expect(screen.getByLabelText(/^priority$/i)).toHaveValue(2);
    await user.type(screen.getByLabelText(/^name$/i), "Zainab Malik");
    await user.type(screen.getByLabelText(/relationship/i), "Aunt");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-3333333");
    // Scoped to the open dialog: the tab's own "Add contact" trigger button stays
    // rendered behind it and shares this exact text, so an unscoped query here would
    // match two elements.
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^add contact$/i }),
    );

    await waitFor(() => {
      expect(mockAddEmergencyContact).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          name: "Zainab Malik",
          relationship: "Aunt",
          phone: "0300-3333333",
          priority: 2,
        }),
      );
    });
  });

  it("shows a server field error for alt_phone instead of failing silently", async () => {
    // Regression for a missing <FormMessage /> on the alt_phone field (same class of bug
    // as GuardianFormDialog's — see guardian-form-dialog.test.tsx): without it,
    // applyServerFieldErrors still calls form.setError("alt_phone", ...) and marks the
    // field as matched (suppressing the dialog-level fallback toast too), but nothing
    // was rendered to show it — a save that silently appeared to do nothing.
    mockFetchEmergencyContacts.mockResolvedValue([]);
    mockAddEmergencyContact.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Validation failed.",
        status: 422,
        url: "/students/student-1/emergency-contacts",
        details: [{ field: "alt_phone", issue: "Enter a valid alternate phone number." }],
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await user.click(await screen.findByRole("button", { name: /add contact/i }));
    await user.type(screen.getByLabelText(/^name$/i), "Zainab Malik");
    await user.type(screen.getByLabelText(/relationship/i), "Aunt");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-3333333");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^add contact$/i }),
    );

    expect(await screen.findByText("Enter a valid alternate phone number.")).toBeInTheDocument();
  });

  it("shows a friendly required message, not raw zod text, when priority is cleared", async () => {
    // Regression: `valueAsNumber` is `NaN` for a cleared number input, and writing that
    // straight into the form used to let zod's own "Expected number, received nan" reach
    // the user instead of a normal required-field message.
    mockFetchEmergencyContacts.mockResolvedValue([]);
    const user = userEvent.setup();

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await user.click(await screen.findByRole("button", { name: /add contact/i }));
    await user.type(screen.getByLabelText(/^name$/i), "Zainab Malik");
    await user.type(screen.getByLabelText(/relationship/i), "Aunt");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-3333333");
    await user.clear(screen.getByLabelText(/^priority$/i));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^add contact$/i }),
    );

    const message = await screen.findByText(/priority is required/i);
    expect(message.textContent).not.toMatch(/nan/i);
    expect(message.textContent).not.toMatch(/expected number/i);
    expect(mockAddEmergencyContact).not.toHaveBeenCalled();
  });

  it("hides the add action for a caller without create permission", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate={false} />);

    await screen.findByText(/no emergency contacts added yet/i);
    expect(screen.queryByRole("button", { name: /add contact/i })).not.toBeInTheDocument();
  });
});
