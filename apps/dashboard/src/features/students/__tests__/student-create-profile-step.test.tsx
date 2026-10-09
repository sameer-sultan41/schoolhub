import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateProfileStep } from "../student-create-profile-step";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
    students: { createStudent: jest.fn() },
  },
}));

const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;

async function fillRequiredFields() {
  await userEvent.type(screen.getByLabelText(/first name/i), "Ayesha");
  await userEvent.type(screen.getByLabelText(/last name/i), "Khan");
  await userEvent.type(screen.getByLabelText(/date of birth/i), "2012-05-01");
  await userEvent.type(screen.getByLabelText(/admission date/i), "2026-01-10");
  await userEvent.click(screen.getByRole("combobox", { name: /gender/i }));
  await userEvent.click(await screen.findByRole("option", { name: /female/i }));
  await userEvent.click(screen.getByRole("combobox", { name: /^campus$/i }));
  await userEvent.click(await screen.findByRole("option", { name: "Main" }));
}

function submitProfileForm() {
  const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
  form.requestSubmit();
}

describe("StudentCreateProfileStep", () => {
  beforeEach(() => {
    mockCreateStudent.mockReset();
  });

  it("calls onCreated with the new student's id, campus and name on success", async () => {
    mockCreateStudent.mockResolvedValue({
      id: "student-1",
      campus_id: "campus-1",
      first_name: "Ayesha",
      last_name: "Khan",
    } as never);
    const onCreated = jest.fn();
    renderWithProviders(
      <StudentCreateProfileStep onCreated={onCreated} onUploadingChange={jest.fn()} />,
    );

    await fillRequiredFields();
    submitProfileForm();

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        id: "student-1",
        campusId: "campus-1",
        name: "Ayesha Khan",
      });
    });
  });

  it("does not call createStudent twice for two rapid submits (Review Focus #1)", async () => {
    mockCreateStudent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ id: "s1", campus_id: "c1" } as never);
          }, 50);
        }),
    );
    renderWithProviders(
      <StudentCreateProfileStep onCreated={jest.fn()} onUploadingChange={jest.fn()} />,
    );

    await fillRequiredFields();
    submitProfileForm();
    submitProfileForm();

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
  });
});
