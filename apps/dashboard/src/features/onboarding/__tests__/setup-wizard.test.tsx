import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  campusRecord,
  sessionRecord,
  structurePage,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { cursorPage } from "@/test-fixtures/list-screen";
import { onboardingRecord } from "@/test-fixtures/onboarding";
import { buildUser, renderWithClient, renderWithProviders, setUrl } from "@/test-utils";

import { SetupWizard } from "../setup-wizard";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    onboarding: { fetchOnboarding: jest.fn(), updateOnboarding: jest.fn() },
    schoolSettings: { fetchSchoolSettings: jest.fn() },
    schoolOrganization: {
      fetchCampusPage: jest.fn(),
      createCampus: jest.fn(),
      updateCampus: jest.fn(),
      deleteCampus: jest.fn(),
      fetchSessionPage: jest.fn(),
      activateSession: jest.fn(),
      fetchSubjectPage: jest.fn(),
    },
    dashboard: { fetchDepartments: jest.fn() },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const onboarding = Services.onboarding as jest.Mocked<typeof Services.onboarding>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchSchoolSettings = Services.schoolSettings.fetchSchoolSettings as jest.MockedFunction<
  typeof Services.schoolSettings.fetchSchoolSettings
>;

/** `school_admin`'s keys for the steps (`school_organization/permissions.py`). */
const SCHOOL_ADMIN: PermissionKey[] = [
  "school.settings.view",
  "school.settings.update",
  "school.campus.view",
  "school.campus.create",
  "school.campus.update",
  "school.academic-session.view",
  "school.academic-session.create",
  "school.academic-session.update",
  "school.academic-session.activate",
  "school.academic-session.close",
  "school.class.create",
  "school.section.create",
  "school.subject.view",
  "school.subject.create",
  "students.student.import",
];

const PLANNED = sessionRecord({ name: "2027-28", status: "planned", is_current: false });

function renderWizard(url: string) {
  setUrl(url);
  renderWithProviders(<SetupWizard />);
  return userEvent.setup();
}

function stepButton(title: string) {
  const nav = screen.getByRole("navigation", { name: "Setup steps" });
  return within(nav).getByRole("button", { name: new RegExp(`^${title}`) });
}

describe("setup wizard", () => {
  beforeEach(() => {
    mockFetchCurrentUser.mockReset().mockResolvedValue(buildUser(SCHOOL_ADMIN));
    onboarding.fetchOnboarding
      .mockReset()
      .mockResolvedValue(onboardingRecord({ done: ["profile"] }));
    onboarding.updateOnboarding.mockReset();
    mockFetchSchoolSettings.mockReset().mockReturnValue(new Promise(() => {}));
    so.fetchCampusPage.mockReset().mockResolvedValue(structurePage([campusRecord()]));
    so.createCampus.mockReset();
    so.fetchSessionPage.mockReset().mockResolvedValue(cursorPage([PLANNED]));
    so.activateSession.mockReset();
    so.fetchSubjectPage.mockReset().mockResolvedValue(structurePage([]));
  });

  it("lists every step with its status and opens the one the URL names", async () => {
    renderWizard("/setup?step=campuses");

    expect(await screen.findByRole("button", { name: "Add campus" })).toBeInTheDocument();
    expect(stepButton("School profile")).toHaveTextContent("Done");
    expect(stepButton("Campuses")).toHaveAttribute("aria-current", "step");
    expect(stepButton("Campuses")).toHaveTextContent("To do · 0 records");
    // The embedded section's own heading, not a second one from the wizard.
    expect(screen.getAllByRole("heading", { name: "Campuses" })).toHaveLength(1);
  });

  it("opens the first step the viewer can act on when the URL names none", async () => {
    renderWizard("/setup");

    expect(await screen.findByRole("heading", { name: "Campuses" })).toBeInTheDocument();
    expect(stepButton("Campuses")).toHaveAttribute("aria-current", "step");
  });

  it("clears the embedded list's URL keys when the step changes", async () => {
    const user = renderWizard("/setup?step=campuses&search=north&page=2&status=all&sort=-name");
    await screen.findByRole("button", { name: "Add campus" });

    await user.click(stepButton("Subjects"));

    await waitFor(() => {
      expect(window.location.search).toBe("?step=subjects");
    });
    expect(await screen.findByRole("heading", { name: "Subjects" })).toBeInTheDocument();
  });

  it("shows a school admin the session step's add action and go-live's activate action", async () => {
    const user = renderWizard("/setup?step=academic_session");

    expect(await screen.findByRole("button", { name: "Add session" })).toBeInTheDocument();

    await user.click(stepButton("Go live"));

    expect(await screen.findByRole("button", { name: "Activate 2027-28" })).toBeInTheDocument();
    expect(so.fetchSessionPage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "planned" }),
    );
  });

  it("offers Skip only on a skippable step, and sends it", async () => {
    onboarding.updateOnboarding.mockResolvedValue(
      onboardingRecord({ done: ["profile"], skipped: ["students"] }),
    );
    const user = renderWizard("/setup?step=campuses");
    await screen.findByRole("button", { name: "Add campus" });
    expect(screen.queryByRole("button", { name: "Skip this step" })).not.toBeInTheDocument();

    await user.click(stepButton("Import students"));
    await user.click(await screen.findByRole("button", { name: "Skip this step" }));

    await waitFor(() => {
      expect(onboarding.updateOnboarding).toHaveBeenCalledWith({ skip: "students" });
    });
    expect(await screen.findByRole("button", { name: "Undo skip" })).toBeInTheDocument();
    expect(stepButton("Import students")).toHaveTextContent("Skipped");
    expect(screen.getByRole("link", { name: "Import students" })).toHaveAttribute(
      "href",
      "/students?import=1",
    );
  });

  it("confirms the profile", async () => {
    onboarding.fetchOnboarding.mockResolvedValue(onboardingRecord());
    onboarding.updateOnboarding.mockResolvedValue(onboardingRecord({ done: ["profile"] }));
    const user = renderWizard("/setup?step=profile");

    await user.click(await screen.findByRole("button", { name: "Confirm profile" }));

    await waitFor(() => {
      expect(onboarding.updateOnboarding).toHaveBeenCalledWith({ confirm: "profile" });
    });
    expect(await screen.findByRole("button", { name: "Profile confirmed" })).toBeDisabled();
  });

  it("tells a viewer without a step's key that someone else does it", async () => {
    mockFetchCurrentUser.mockResolvedValue(
      buildUser(["school.settings.view", "school.campus.view", "school.campus.create"]),
    );
    renderWizard("/setup?step=fee_structures");

    expect(
      await screen.findByText(
        "You don't have permission for this step. Ask someone who manages it to complete it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip this step" })).not.toBeInTheDocument();
  });

  it("says setup is finished once it is", async () => {
    onboarding.fetchOnboarding.mockResolvedValue(
      onboardingRecord({
        done: ["profile", "campuses", "academic_session", "classes", "subjects", "go_live"],
        skipped: ["fee_structures", "staff_invites", "students"],
        completedAt: "2026-11-16T10:00:00Z",
      }),
    );
    renderWizard("/setup");

    expect(await screen.findByText("Your school is set up")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Setup steps" })).not.toBeInTheDocument();
  });

  it("refreshes the checklist after a campus is added inside the wizard", async () => {
    so.createCampus.mockResolvedValue(campusRecord());
    setUrl("/setup?step=campuses");
    const { queryClient } = renderWithClient(<SetupWizard />);
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add campus" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "North Campus");
    await user.type(within(dialog).getByLabelText("Code"), "NORTH");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createCampus).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.onboarding() });
    });
  });
});
