import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { renderWithProviders } from "@/test-utils";

import { StudentToolbar } from "../student-toolbar";

// `ToolbarHeading` (used inside `StudentToolbar` via `Toolbar`) calls `usePathname()` to
// resolve the page title from `menu-config.ts` — outside a real Next.js App Router tree
// `usePathname()` has no route to read, and `useMenu`'s own `isActive` unconditionally
// calls `pathname.startsWith(...)`, which throws on a nullish pathname. Matches
// `staff-toolbar.test.tsx`'s own identical mock.
jest.mock("next/navigation", () => ({ usePathname: () => "/students" }));

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchStudentsPage: jest.fn(),
      triggerStudentExport: jest.fn(),
      triggerStudentImport: jest.fn(),
    },
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
    jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() },
  },
  // The real class: `StudentCreateProfileStep` `instanceof`-checks it.
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
}));

// The export's outcomes surface as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

interface MockCurrentUserResult {
  data: AuthenticatedUser | undefined;
  isError: boolean;
}
const mockUseCurrentUser = jest.fn<MockCurrentUserResult, []>();
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const mockFetchStudentsPage = Services.students.fetchStudentsPage as jest.MockedFunction<
  typeof Services.students.fetchStudentsPage
>;

const mockTriggerStudentExport = Services.students.triggerStudentExport as jest.MockedFunction<
  typeof Services.students.triggerStudentExport
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchFileDownloadUrl = Services.jobs.fetchFileDownloadUrl as jest.MockedFunction<
  typeof Services.jobs.fetchFileDownloadUrl
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

const PERMITTED_USER: AuthenticatedUser = {
  id: "u1",
  email: "records@example.com",
  phone: null,
  full_name: "Records Manager",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["students.student.view", "students.student.create"],
};

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return { ...PERMITTED_USER, permissions: ["students.student.view", ...permissions] };
}

function resolveStats() {
  mockFetchStudentsPage.mockResolvedValue({
    items: [],
    pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
  });
}

function exportJob(
  id: string,
  status: "running" | "succeeded",
  fileId?: string,
): BackgroundJobRecord {
  return {
    id,
    job_type: "export.students",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result: fileId ? { result_file_id: fileId } : null,
    error: null,
  };
}

describe("StudentToolbar", () => {
  beforeEach(() => {
    mockFetchStudentsPage.mockReset();
    mockTriggerStudentExport.mockReset();
    mockFetchJob.mockReset();
    mockFetchFileDownloadUrl.mockReset();
    mockToastSuccess.mockReset();
    mockUseCurrentUser.mockReset().mockReturnValue({ data: PERMITTED_USER, isError: false });
  });

  // Restores the anchor-click spy even when an assertion above it failed.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the total and active counts as two distinct figures", async () => {
    mockFetchStudentsPage.mockImplementation((q) =>
      Promise.resolve({
        items: [],
        pagination: {
          page: 1,
          page_size: 1,
          total_count: q.status === "active" ? 190 : 214,
          total_pages: 1,
        },
      }),
    );

    renderWithProviders(<StudentToolbar />);

    await waitFor(() => {
      expect(screen.getByText("214")).toBeInTheDocument();
    });
    expect(screen.getByText("190")).toBeInTheDocument();
  });

  it("opens the create-student dialog when New student is clicked", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentToolbar />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /new student/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows unavailable, not a stale figure, when a stat query fails", async () => {
    mockFetchStudentsPage.mockRejectedValue(new Error("network down"));

    renderWithProviders(<StudentToolbar />);

    expect(await screen.findAllByText("—")).toHaveLength(2);
  });

  it("explains via the New-student button's title why it's disabled when permissions failed to load", async () => {
    mockUseCurrentUser.mockReturnValue({ data: undefined, isError: true });
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentToolbar />);

    const button = await screen.findByRole("button", { name: /new student/i });
    expect(button).toBeDisabled();
    expect(button.closest("span")).toHaveAttribute("title", expect.stringMatching(/permission/i));
  });

  it("disables Export CSV and Import CSV without the export/import permissions, saying why", () => {
    resolveStats();

    renderWithProviders(<StudentToolbar />);

    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    const importButton = screen.getByRole("button", { name: "Import CSV" });
    expect(exportButton).toBeDisabled();
    expect(importButton).toBeDisabled();
    expect(exportButton.closest("span")).toHaveAttribute(
      "title",
      "You don't have permission to export students.",
    );
    expect(importButton.closest("span")).toHaveAttribute(
      "title",
      "You don't have permission to import students.",
    );
  });

  it("disables both buttons, titled as still checking, while permissions load", () => {
    mockUseCurrentUser.mockReturnValue({ data: undefined, isError: false });
    resolveStats();

    renderWithProviders(<StudentToolbar />);

    for (const name of ["Export CSV", "Import CSV"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.closest("span")).toHaveAttribute("title", "Checking your permissions…");
    }
  });

  it("shows no permission title on Export/Import for a user who holds both permissions", () => {
    mockUseCurrentUser.mockReturnValue({
      data: userWith("students.student.export", "students.student.import"),
      isError: false,
    });
    resolveStats();

    renderWithProviders(<StudentToolbar />);

    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeEnabled();
    expect(screen.queryByTitle("You don't have permission to export students.")).toBeNull();
    expect(screen.queryByTitle("You don't have permission to import students.")).toBeNull();
  });

  it("Export CSV starts one export, downloads the finished file and toasts success", async () => {
    mockUseCurrentUser.mockReturnValue({
      data: userWith("students.student.export"),
      isError: false,
    });
    resolveStats();
    mockTriggerStudentExport.mockResolvedValue({ jobId: "job-export-1" });
    mockFetchJob.mockResolvedValue(exportJob("job-export-1", "succeeded", "f1"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/students-export.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StudentToolbar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f1");
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Student list exported");
    });
    expect(mockTriggerStudentExport).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/students-export.csv");
    expect(anchor.download).toBe("students-export.csv");
  });

  it("Export CSV is disabled and reads Exporting while the job is still running", async () => {
    mockUseCurrentUser.mockReturnValue({
      data: userWith("students.student.export"),
      isError: false,
    });
    resolveStats();
    mockTriggerStudentExport.mockResolvedValue({ jobId: "job-export-2" });
    mockFetchJob.mockResolvedValue(exportJob("job-export-2", "running"));

    renderWithProviders(<StudentToolbar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("button", { name: "Exporting…" })).toBeDisabled();
    expect(mockTriggerStudentExport).toHaveBeenCalledTimes(1);
  });

  it("after a failed poll, Check export status resumes the same job instead of exporting again", async () => {
    mockUseCurrentUser.mockReturnValue({
      data: userWith("students.student.export"),
      isError: false,
    });
    resolveStats();
    mockTriggerStudentExport.mockResolvedValue({ jobId: "job-export-3" });
    mockFetchJob
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(exportJob("job-export-3", "succeeded", "f3"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/students-export.csv");
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<StudentToolbar />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await user.click(await screen.findByRole("button", { name: "Check export status" }));

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f3");
    });
    expect(mockTriggerStudentExport).toHaveBeenCalledTimes(1);
  });

  it("Import CSV opens the import dialog listing the required columns", async () => {
    mockUseCurrentUser.mockReturnValue({
      data: userWith("students.student.import"),
      isError: false,
    });
    resolveStats();

    renderWithProviders(<StudentToolbar />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Import CSV" }));

    const dialog = await screen.findByRole("dialog", { name: "Import students" });
    expect(within(dialog).getByText("campus_code")).toBeInTheDocument();
    expect(within(dialog).getByText("preferred_name")).toBeInTheDocument();
  });
});
