import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

import { Services, type StudentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { StudentCreateProfileStep } from "../student-create-profile-step";
import messages from "../../../../messages/en.json";

jest.mock("@/services", () => ({
  Services: {
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([{ id: "campus-1", name: "Main" }]) },
    schoolOrganization: {
      fetchHouses: jest.fn().mockResolvedValue([{ id: "house-1", name: "Blue House" }]),
    },
    students: {
      createStudent: jest.fn(),
      updateStudent: jest.fn(),
      fetchStudentById: jest.fn(),
    },
  },
}));

const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;
const mockUpdateStudent = Services.students.updateStudent as jest.MockedFunction<
  typeof Services.students.updateStudent
>;
const mockFetchStudentById = Services.students.fetchStudentById as jest.MockedFunction<
  typeof Services.students.fetchStudentById
>;

/** Same shape as `student-directory-table.test.tsx`'s own `studentRecord` fixture —
 * every nullable field defaults to a real, non-null value so an override only ever
 * changes the field a given test actually cares about. */
function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "stu-1",
    admission_number: "2026-0050",
    first_name: "Aisha",
    last_name: "Khan",
    preferred_name: "Ash",
    date_of_birth: "2015-03-12",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-1",
    campus_name: "Main",
    house_id: "house-1",
    house_name: "Blue House",
    status: "active",
    admission_date: "2026-01-10",
    blood_group: "O+",
    nationality: "Pakistani",
    religion: "Islam",
    previous_school: "City Grammar School",
    medical_notes: "No known allergies.",
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

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

describe("StudentCreateProfileStep — create mode", () => {
  beforeEach(() => {
    mockCreateStudent.mockReset();
  });

  it("calls onSaved with the new student's id, campus and name on success", async () => {
    mockCreateStudent.mockResolvedValue({
      id: "student-1",
      campus_id: "campus-1",
      first_name: "Ayesha",
      last_name: "Khan",
    } as never);
    const onSaved = jest.fn();
    renderWithProviders(
      <StudentCreateProfileStep
        mode="create"
        onSaved={onSaved}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    await fillRequiredFields();
    submitProfileForm();

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith({
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
      <StudentCreateProfileStep
        mode="create"
        onSaved={jest.fn()}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    await fillRequiredFields();
    submitProfileForm();
    submitProfileForm();

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call createStudent again from a submit landing right after success (Review Focus #1, render-timing gap)", async () => {
    // Distinct from the rapid-double-click test above: that one covers two submits
    // while the first is still *pending* (`submitGuard`'s own in-flight check). This
    // one covers a submit landing *after* the first has already settled — the window
    // `hasCreatedRef` exists for, since the parent's `locked` prop (not rendered by
    // this standalone test at all) only reopens that door once a re-render the real
    // `StudentCreateStepper` triggers from this same `onSuccess` has actually run.
    mockCreateStudent.mockResolvedValue({ id: "s1", campus_id: "c1" } as never);
    const onSaved = jest.fn();
    renderWithProviders(
      <StudentCreateProfileStep
        mode="create"
        onSaved={onSaved}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    await fillRequiredFields();
    submitProfileForm();
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    submitProfileForm();

    await waitFor(() => {
      expect(mockCreateStudent).toHaveBeenCalledTimes(1);
    });
  });

  it("never calls createStudent while locked, even with already-entered valid values", async () => {
    // `locked` is the parent's own render-driven gate (true once the real
    // `StudentCreateStepper` has already created this student and the user revisited
    // Profile) — no test here ever set it, so this is its first direct coverage. The
    // fieldset only disables once `locked` flips, so the fields are filled first
    // (not locked yet) and `locked` is applied via `rerender` after — matching how
    // the real stepper actually reaches this state (fill, submit succeeds, revisit).
    // `renderWithProviders`'s own `rerender` drops providers on a bare re-render
    // (same issue `student-create-stepper.test.tsx` hit), so this uses a local
    // `wrapper` instead, same as that file's own fix.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      );
    }
    const onSaved = jest.fn();
    const { rerender } = render(
      <StudentCreateProfileStep
        mode="create"
        onSaved={onSaved}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
      { wrapper: Wrapper },
    );

    await fillRequiredFields();
    rerender(
      <StudentCreateProfileStep
        mode="create"
        onSaved={onSaved}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
        locked
      />,
    );
    submitProfileForm();

    await waitFor(() => {
      expect(mockCreateStudent).not.toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("StudentCreateProfileStep — edit mode", () => {
  beforeEach(() => {
    mockUpdateStudent.mockReset();
    mockFetchStudentById.mockReset();
  });

  it("pre-fills from fetchStudentById and submits updateStudent against that student's id", async () => {
    mockFetchStudentById.mockResolvedValue(studentRecord());
    mockUpdateStudent.mockResolvedValue(
      studentRecord({ first_name: "Aisha", last_name: "Khan-Updated" }),
    );
    const onSaved = jest.fn();
    renderWithProviders(
      <StudentCreateProfileStep
        mode="edit"
        studentId="stu-1"
        onSaved={onSaved}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    expect(await screen.findByDisplayValue("Aisha")).toBeInTheDocument();

    const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => {
      expect(mockUpdateStudent).toHaveBeenCalledWith("stu-1", expect.any(Object));
    });
    expect(onSaved).toHaveBeenCalledWith({
      id: "stu-1",
      campusId: "campus-1",
      name: "Aisha Khan-Updated",
    });
  });

  it("does not call updateStudent twice for two rapid submits", async () => {
    mockFetchStudentById.mockResolvedValue(studentRecord());
    mockUpdateStudent.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(studentRecord());
          }, 50);
        }),
    );
    renderWithProviders(
      <StudentCreateProfileStep
        mode="edit"
        studentId="stu-1"
        onSaved={jest.fn()}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    await screen.findByDisplayValue("Aisha");
    const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();

    await waitFor(() => {
      expect(mockUpdateStudent).toHaveBeenCalledTimes(1);
    });
  });

  it("never calls createStudent in edit mode", async () => {
    mockFetchStudentById.mockResolvedValue(studentRecord());
    mockUpdateStudent.mockResolvedValue(studentRecord());
    renderWithProviders(
      <StudentCreateProfileStep
        mode="edit"
        studentId="stu-1"
        onSaved={jest.fn()}
        onUploadingChange={jest.fn()}
        onSavingChange={jest.fn()}
      />,
    );

    await screen.findByDisplayValue("Aisha");
    const form = document.getElementById("student-create-profile-step") as HTMLFormElement;
    form.requestSubmit();

    await waitFor(() => {
      expect(mockUpdateStudent).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateStudent).not.toHaveBeenCalled();
  });
});
