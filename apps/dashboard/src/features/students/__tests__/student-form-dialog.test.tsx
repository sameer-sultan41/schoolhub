import type { ReactNode } from "react";
import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import enMessages from "../../../../messages/en.json";

import { Services } from "@/services";
import type { StudentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentFormDialog } from "../student-form-dialog";

// Typing ~5 required fields plus two Select picks, across a dozen-plus scenarios, is
// comfortably more than Jest's 5s default on a loaded CI runner — same reasoning as
// staff-form-dialog.test.tsx's own `jest.setTimeout`.
jest.setTimeout(20_000);

jest.mock("@/services", () => ({
  // The real class: components `instanceof`-check it, and tests build `new ApiError(...)`.
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: { fetchHouses: jest.fn() },
    students: {
      fetchStudentById: jest.fn(),
      createStudent: jest.fn(),
      updateStudent: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

// The component calls `toast.success(...)` directly, matching staff-form-dialog.test.tsx's
// own reasoning for mocking only what's actually used.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchHouses = Services.schoolOrganization.fetchHouses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchHouses
>;
const mockFetchStudentById = Services.students.fetchStudentById as jest.MockedFunction<
  typeof Services.students.fetchStudentById
>;
const mockCreateStudent = Services.students.createStudent as jest.MockedFunction<
  typeof Services.students.createStudent
>;
const mockUpdateStudent = Services.students.updateStudent as jest.MockedFunction<
  typeof Services.students.updateStudent
>;
const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

const PERMITTED_USER: AuthenticatedUser = {
  id: "user-1",
  email: "records@example.com",
  phone: null,
  full_name: "Records Manager",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["students.student.view", "students.student.create", "students.student.update"],
};

/** Every reference-data query the dialog fires on open, given sane defaults — each test
 * overrides only the ones it actually cares about. */
function mockReferenceData() {
  mockFetchCurrentUser.mockResolvedValue(PERMITTED_USER);
  mockFetchCampuses.mockResolvedValue([{ id: "c1", name: "Main Campus" }]);
  mockFetchHouses.mockResolvedValue([{ id: "h1", name: "Griffin" }]);
}

function studentDetail(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "s1",
    admission_number: "2026-0007",
    first_name: "Ali",
    last_name: "Khan",
    preferred_name: null,
    date_of_birth: "2012-05-01",
    gender: "male",
    photo_file_id: null,
    photo_url: null,
    campus_id: "c1",
    campus_name: "Main Campus",
    house_id: null,
    house_name: null,
    status: "active",
    admission_date: "2026-01-10",
    blood_group: null,
    nationality: null,
    religion: null,
    previous_school: null,
    medical_notes: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

/** Radix's Select renders its trigger with `role="combobox"` (accessible name from the
 * associated FormLabel) and each option with `role="option"` inside a portal — `screen`
 * already searches the whole document, portal included. */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: RegExp,
) {
  const trigger = await waitFor(() => {
    const element = screen.getByRole("combobox", { name: label });
    expect(element).not.toBeDisabled();
    return element;
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}

/** `<input type="date">` — `userEvent.type` simulates real per-segment keyboard entry
 * jsdom's date input doesn't actually implement, so the value is set directly via a
 * change event instead, same as staff-form-dialog.test.tsx's own `setDate`. */
function setDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

/** jsdom has no object URLs; the photo field creates one for a picked file's local
 * preview — same helper as staff-form-dialog.test.tsx's own `stubObjectUrls`. Descriptors,
 * not method references, so restoring trips no unbound-method lint. */
function stubObjectUrls(url: string) {
  const saved = ["createObjectURL", "revokeObjectURL"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const,
  );
  Object.defineProperty(URL, "createObjectURL", { value: jest.fn(() => url), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: jest.fn(), configurable: true });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else Reflect.deleteProperty(URL, name);
    }
  };
}

/** jsdom never loads images, so Radix's `AvatarImage` would wait forever — reports every
 * image as already loaded, same as staff-form-dialog.test.tsx's `stubImageLoading`. */
function stubImageLoading() {
  const complete = jest.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  const width = jest.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
  return () => {
    complete.mockRestore();
    width.mockRestore();
  };
}

/** Fills every field `studentFormSchema` requires for create — `gender` is not among
 * them: `EMPTY_DEFAULTS.gender` is `"unspecified"`, itself a valid enum member, so the
 * Select never needs to be touched to pass validation. */
async function fillRequiredCreateFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^first name\s*\*?$/i), "Ali");
  await user.type(screen.getByLabelText(/^last name\s*\*?$/i), "Khan");
  setDate(screen.getByLabelText(/^date of birth\s*\*?$/i), "2012-05-01");
  await chooseOption(user, /^campus$/i, /^main campus$/i);
  setDate(screen.getByLabelText(/^admission date\s*\*?$/i), "2026-01-10");
}

describe("StudentFormDialog", () => {
  const onOpenChange = jest.fn();

  beforeEach(() => {
    mockFetchCurrentUser.mockReset();
    mockFetchCampuses.mockReset();
    mockFetchHouses.mockReset();
    mockFetchStudentById.mockReset();
    mockCreateStudent.mockReset();
    mockUpdateStudent.mockReset();
    mockUploadFile.mockReset();
    mockToastSuccess.mockReset();
    onOpenChange.mockReset();
  });

  describe("create mode", () => {
    it("submits createStudent with the filled-in required fields and nothing else", async () => {
      mockReferenceData();
      mockCreateStudent.mockResolvedValue(studentDetail({ id: "s-new" }));
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.click(screen.getByRole("button", { name: /new student/i }));

      await waitFor(() => {
        expect(mockCreateStudent).toHaveBeenCalledWith({
          firstName: "Ali",
          lastName: "Khan",
          dateOfBirth: "2012-05-01",
          gender: "unspecified",
          campusId: "c1",
          admissionDate: "2026-01-10",
          preferredName: undefined,
          houseId: undefined,
          photoFileId: undefined,
          bloodGroup: undefined,
          nationality: undefined,
          religion: undefined,
          previousSchool: undefined,
          medicalNotes: undefined,
          address: undefined,
        });
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockToastSuccess).toHaveBeenCalledWith("Student added.");
    });

    it("blocks submission and never calls createStudent when a required field is left empty", async () => {
      mockReferenceData();
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      // Everything except `last_name` is filled in.
      await user.type(screen.getByLabelText(/^first name\s*\*?$/i), "Ali");
      setDate(screen.getByLabelText(/^date of birth\s*\*?$/i), "2012-05-01");
      await chooseOption(user, /^campus$/i, /^main campus$/i);
      setDate(screen.getByLabelText(/^admission date\s*\*?$/i), "2026-01-10");
      await user.click(screen.getByRole("button", { name: /new student/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/^last name\s*\*?$/i)).toHaveAttribute("aria-invalid", "true");
      });
      expect(mockCreateStudent).not.toHaveBeenCalled();
    });

    it("surfaces the server's duplicate-admission message via its non_field detail", async () => {
      mockReferenceData();
      mockCreateStudent.mockRejectedValue(
        new ApiError({
          code: "domain_rule_violation",
          message: "Validation failed.",
          status: 422,
          url: "/students",
          details: [
            {
              field: "non_field",
              issue:
                "A student named 'Ali Khan' with the same date of birth already exists (admission number 2026-0007). Pass an override reason to create anyway.",
            },
          ],
        }),
      );
      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await fillRequiredCreateFields(userEvent.setup());
      await userEvent.setup().click(screen.getByRole("button", { name: /new student/i }));
      expect(
        await screen.findByText(
          /A student named 'Ali Khan'.*already exists.*Pass an override reason/i,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /override/i })).not.toBeInTheDocument();
    });

    it("discards a photo upload from a session that already closed, even if the dialog reopened before it resolved", async () => {
      // Deliberately not `renderWithProviders` — reproducing "closed then reopened before
      // the upload settled" needs the SAME component instance across the open/close/open
      // prop changes, not a fresh mount each time. Mirrors staff-form-dialog.test.tsx's own
      // "reopening after closing" regression test, which documents exactly this need — but
      // unlike staff's version, this component calls `useTranslations`, so the local wrapper
      // needs `NextIntlClientProvider` too (round-3 review finding: a `QueryClientProvider`
      // alone made the first render throw before the test reached any assertion).
      mockReferenceData();
      let resolveUpload: (url: string) => void = () => {};
      mockUploadFile.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      );
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      function Wrapper({ children }: { children: ReactNode }) {
        return (
          <NextIntlClientProvider locale="en" messages={enMessages}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </NextIntlClientProvider>
        );
      }
      const restoreObjectUrls = stubObjectUrls("blob:stale-photo");
      // Unmounted before the stubs are restored: the photo field revokes its object URL on unmount.
      let unmount: (() => void) | undefined;
      try {
        const { rerender, unmount: unmountDialog } = render(
          <StudentFormDialog open mode="create" onOpenChange={onOpenChange} />,
          { wrapper: Wrapper },
        );
        unmount = unmountDialog;
        await userEvent
          .setup()
          .upload(
            screen.getByLabelText(/^photo$/i),
            new File(["x"], "photo.jpg", { type: "image/jpeg" }),
          );
        rerender(<StudentFormDialog open={false} mode="create" onOpenChange={onOpenChange} />);
        rerender(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />); // reopened before the upload resolved
        resolveUpload("file-123");
        await waitFor(() => {}); // flush the upload's now-stale continuation before proceeding
        await fillRequiredCreateFields(userEvent.setup());
        // The closed session's upload must not hold Save disabled in the reopened one.
        await userEvent.setup().click(screen.getByRole("button", { name: /new student/i }));
        await waitFor(() => {
          expect(mockCreateStudent).toHaveBeenCalled();
        });
        expect(mockCreateStudent).toHaveBeenCalledWith(
          expect.not.objectContaining({ photoFileId: expect.anything() }),
        );
      } finally {
        unmount?.();
        restoreObjectUrls();
      }
    });

    it("sends a preferred name typed into its own field", async () => {
      mockReferenceData();
      mockCreateStudent.mockResolvedValue(studentDetail({ id: "s-new" }));
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.type(screen.getByLabelText(/^preferred name$/i), "Ali K");
      await user.click(screen.getByRole("button", { name: /new student/i }));

      await waitFor(() => {
        expect(mockCreateStudent).toHaveBeenCalledWith(
          expect.objectContaining({ preferredName: "Ali K" }),
        );
      });
    });
  });

  describe("photo upload", () => {
    it("disables Save while a photo is uploading, then submits the uploaded file id", async () => {
      mockReferenceData();
      mockCreateStudent.mockResolvedValue(studentDetail({ id: "s-new" }));
      let resolveUpload: (fileId: string) => void = () => {};
      mockUploadFile.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      );
      const user = userEvent.setup();
      const restoreObjectUrls = stubObjectUrls("blob:new-photo");
      // Unmounted before the stubs are restored: the photo field revokes its object URL on unmount.
      let unmount: (() => void) | undefined;
      try {
        ({ unmount } = renderWithProviders(
          <StudentFormDialog open mode="create" onOpenChange={onOpenChange} />,
        ));
        await screen.findByRole("combobox", { name: /^campus$/i });
        await fillRequiredCreateFields(user);
        await user.upload(
          screen.getByLabelText(/^photo$/i),
          new File(["x"], "photo.jpg", { type: "image/jpeg" }),
        );

        // Saving now would report success and silently drop the photo.
        const save = screen.getByRole("button", { name: /new student/i });
        expect(save).toBeDisabled();
        expect(screen.getByText("Uploading photo…")).toBeInTheDocument();

        resolveUpload("file-123");
        await waitFor(() => {
          expect(save).toBeEnabled();
        });
        await user.click(save);

        await waitFor(() => {
          expect(mockCreateStudent).toHaveBeenCalledWith(
            expect.objectContaining({ photoFileId: "file-123" }),
          );
        });
      } finally {
        unmount?.();
        restoreObjectUrls();
      }
    });

    it("shows the upload's own failure message, not the generic fallback, and re-enables Save", async () => {
      mockReferenceData();
      // `uploadFile` rejects with a `FileUploadError` (an `Error`) carrying the backend's
      // own validation text — the field must show that text, not a generic retry message.
      mockUploadFile.mockRejectedValue(
        new Error("'image/png' is not allowed for 'student.photo' uploads."),
      );
      const user = userEvent.setup();
      const restoreObjectUrls = stubObjectUrls("blob:rejected-photo");
      let unmount: (() => void) | undefined;
      try {
        ({ unmount } = renderWithProviders(
          <StudentFormDialog open mode="create" onOpenChange={onOpenChange} />,
        ));
        await screen.findByRole("combobox", { name: /^campus$/i });
        await user.upload(
          screen.getByLabelText(/^photo$/i),
          new File(["x"], "photo.png", { type: "image/png" }),
        );

        expect(
          await screen.findByText("'image/png' is not allowed for 'student.photo' uploads."),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Something went wrong. Please try again."),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /new student/i })).toBeEnabled();
      } finally {
        unmount?.();
        restoreObjectUrls();
      }
    });

    it("previews the saved photo in edit mode", async () => {
      const restoreImages = stubImageLoading();
      try {
        mockReferenceData();
        mockFetchStudentById.mockResolvedValue(
          studentDetail({ photo_file_id: "file-1", photo_url: "https://storage.test/ali.png" }),
        );

        renderWithProviders(
          <StudentFormDialog open mode="edit" studentId="s1" onOpenChange={onOpenChange} />,
        );

        const dialog = await screen.findByRole("dialog", { name: "Edit student" });
        await waitFor(() => {
          expect(dialog.querySelector("img")).toHaveAttribute(
            "src",
            "https://storage.test/ali.png",
          );
        });
      } finally {
        restoreImages();
      }
    });
  });

  describe("edit mode", () => {
    it("pre-fills from fetchStudentById and submits updateStudent against that student's id", async () => {
      mockReferenceData();
      mockFetchStudentById.mockResolvedValue(studentDetail());
      mockUpdateStudent.mockResolvedValue(studentDetail({ updated_at: "2026-02-01T00:00:00Z" }));
      const user = userEvent.setup();

      renderWithProviders(
        <StudentFormDialog open mode="edit" studentId="s1" onOpenChange={onOpenChange} />,
      );

      // The dialog shows a loading placeholder (`isDetailLoading`) until the detail
      // record resolves and `form.reset` has actually applied it.
      expect(await screen.findByDisplayValue("Ali")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Khan")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdateStudent).toHaveBeenCalledWith("s1", {
          firstName: "Ali",
          lastName: "Khan",
          dateOfBirth: "2012-05-01",
          gender: "male",
          campusId: "c1",
          admissionDate: "2026-01-10",
          // null, not undefined: every optional field on `studentDetail()` is null, so
          // the form loads each as an explicit "empty" value, and submitting unchanged
          // resends that same explicit null — see `buildStudentInput`'s own comment on
          // why this isn't dirty-tracked.
          preferredName: null,
          houseId: null,
          photoFileId: undefined,
          bloodGroup: null,
          nationality: null,
          religion: null,
          previousSchool: null,
          medicalNotes: null,
          address: null,
        });
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(mockToastSuccess).toHaveBeenCalledWith("Student updated.");
    });

    it("clears a house on edit by sending null, not omitting the field", async () => {
      mockReferenceData();
      mockFetchStudentById.mockResolvedValue(
        studentDetail({ house_id: "h1", house_name: "Griffin" }),
      );
      mockUpdateStudent.mockResolvedValue(studentDetail());
      renderWithProviders(
        <StudentFormDialog open mode="edit" studentId="s1" onOpenChange={onOpenChange} />,
      );
      await screen.findByDisplayValue(/griffin/i);
      await userEvent.setup().click(screen.getByRole("combobox", { name: /house/i }));
      await userEvent.setup().click(screen.getByRole("option", { name: /none/i }));
      await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));
      expect(mockUpdateStudent).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ houseId: null }),
      );
    });

    it("hides the restricted medical notes field for a user without the update permission", async () => {
      mockReferenceData();
      mockFetchCurrentUser.mockResolvedValue({
        ...PERMITTED_USER,
        permissions: ["students.student.view"],
      });
      mockFetchStudentById.mockResolvedValue(studentDetail());

      renderWithProviders(
        <StudentFormDialog open mode="edit" studentId="s1" onOpenChange={onOpenChange} />,
      );
      await screen.findByDisplayValue("Ali");

      await waitFor(() => {
        expect(screen.queryByLabelText(/medical notes/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("server-side field errors", () => {
    it("maps an ApiError's field details onto the matching form fields", async () => {
      mockReferenceData();
      mockCreateStudent.mockRejectedValue(
        new ApiError({
          code: "validation_error",
          message: "Invalid",
          status: 422,
          url: "/students",
          details: [{ field: "first_name", issue: "This name is already registered." }],
        }),
      );
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.click(screen.getByRole("button", { name: /new student/i }));

      expect(await screen.findByText("This name is already registered.")).toBeInTheDocument();
      // A mapped field error already has somewhere to show (its own FormMessage) — the
      // generic top-of-form fallback must not also render the same failure a second time.
      expect(screen.queryByText("Invalid")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("shows a server error on a profile text field as visible text under that field", async () => {
      // `blood_group` lives in `StudentProfileTextFields`: the dialog maps the error onto it
      // and suppresses its top-level alert, so the field's own FormMessage is the only place
      // this text can appear.
      mockReferenceData();
      mockCreateStudent.mockRejectedValue(
        new ApiError({
          code: "validation_error",
          message: "Invalid",
          status: 422,
          url: "/students",
          details: [
            { field: "blood_group", issue: "Ensure this field has no more than 8 characters." },
          ],
        }),
      );
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.type(screen.getByLabelText(/^blood group$/i), "O positive");
      await user.click(screen.getByRole("button", { name: /new student/i }));

      expect(
        await screen.findByText("Ensure this field has no more than 8 characters."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/^blood group$/i)).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByText("Invalid")).not.toBeInTheDocument();
    });

    it("shows a generic fallback alert for an error this form has no field to display", async () => {
      mockReferenceData();
      mockCreateStudent.mockRejectedValue(
        new ApiError({
          code: "server_error",
          message: "Something went wrong on our side. The team has been notified.",
          status: 500,
          url: "/students",
        }),
      );
      const user = userEvent.setup();

      renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
      await screen.findByRole("combobox", { name: /^campus$/i });

      await fillRequiredCreateFields(user);
      await user.click(screen.getByRole("button", { name: /new student/i }));

      expect(
        await screen.findByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });
  });
});
