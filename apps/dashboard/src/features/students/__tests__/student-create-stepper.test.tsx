import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateStepper } from "../student-create-stepper";

jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: jest.fn(),
}));
jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: {
      fetchHouses: jest.fn().mockResolvedValue([]),
      fetchClasses: jest.fn().mockResolvedValue([]),
      fetchSections: jest.fn().mockResolvedValue([]),
      fetchAcademicSessions: jest.fn().mockResolvedValue([]),
    },
    students: {
      createStudent: jest.fn(),
      fetchStudentHistory: jest.fn().mockResolvedValue([]),
    },
    studentTransfers: { fetchStudentTransfers: jest.fn().mockResolvedValue([]) },
  },
}));

import { useCurrentUser } from "@/hooks/use-current-user";

const mockUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;
const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;

function userWith(permissions: string[]) {
  return {
    data: { id: "u1", permissions, tenant: "t1", email: "a@b.com" },
  } as never;
}

async function fillAndSubmitProfile() {
  await userEvent.type(screen.getByLabelText(/first name/i), "Ayesha");
  await userEvent.type(screen.getByLabelText(/last name/i), "Khan");
  await userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01");
  await userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10");
  await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
  await userEvent.click(await screen.findByRole("option", { name: /female/i }));
  await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
  await userEvent.click(await screen.findByRole("option", { name: "Main" }));
  // The Profile step's primary submit button reads "Next" when a later step
  // exists, "Finish" otherwise (a viewer with only `students.student.create`) —
  // Profile also offers a separate outline "Finish" button once a later step
  // exists, so prefer "Next" and fall back to "Finish" rather than matching both.
  const nextButton = screen.queryByRole("button", { name: /^next$/i });
  await userEvent.click(nextButton ?? screen.getByRole("button", { name: /^finish$/i }));
}

describe("StudentCreateStepper", () => {
  beforeEach(() => {
    mockCreateStudent.mockReset();
    mockCreateStudent.mockResolvedValue({
      id: "student-1",
      campus_id: "campus-1",
      first_name: "Ayesha",
      last_name: "Khan",
    } as never);
  });

  it("shows Profile → Finish only for a viewer with just students.student.create (Review Focus #3)", async () => {
    mockUseCurrentUser.mockReturnValue(userWith(["students.student.create"]));
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();

    expect(await screen.findByRole("button", { name: /^finish$/i })).toBeInTheDocument();
    expect(screen.queryByText(/guardians/i)).not.toBeInTheDocument();
  });

  it("shows the created-student banner once Profile succeeds", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();

    expect(await screen.findByText(/ayesha khan/i)).toBeInTheDocument();
  });

  it("never shows a Back button that returns to Profile", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    renderWithProviders(<StudentCreateStepper open onOpenChange={jest.fn()} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2) — Back should not be offered yet (only from step 3 on).
    expect(screen.queryByRole("button", { name: /^previous$/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // Now on Emergency Contacts (step 3) — Back is offered, and going back must land
    // on Guardians, never Profile.
    await userEvent.click(screen.getByRole("button", { name: /^previous$/i }));

    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it("lets the user finish right from Profile, skipping every later step", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    const onOpenChange = jest.fn();
    renderWithProviders(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText(/first name/i), "Ayesha");
    await userEvent.type(screen.getByLabelText(/last name/i), "Khan");
    await userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01");
    await userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10");
    await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
    await userEvent.click(await screen.findByRole("option", { name: /female/i }));
    await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Main" }));

    await userEvent.click(screen.getByRole("button", { name: /^finish$/i }));

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lets the user finish immediately from a middle step instead of clicking Next through the rest", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create", "students.student.update"]),
    );
    const onOpenChange = jest.fn();
    renderWithProviders(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await fillAndSubmitProfile();
    // Now on Guardians (step 2 of 3) — a Finish button should be offered alongside
    // Next, since every step past Profile is optional.
    await userEvent.click(await screen.findByRole("button", { name: /^finish$/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets to a fresh wizard on reopen (Review Focus #4)", async () => {
    mockUseCurrentUser.mockReturnValue(
      userWith(["students.student.create", "students.guardian.create"]),
    );
    const onOpenChange = jest.fn();
    const { rerender } = renderWithProviders(
      <StudentCreateStepper open onOpenChange={onOpenChange} />,
    );

    await fillAndSubmitProfile();
    expect(await screen.findByText(/ayesha khan/i)).toBeInTheDocument();

    rerender(<StudentCreateStepper open={false} onOpenChange={onOpenChange} />);
    rerender(<StudentCreateStepper open onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    });
  });
});
