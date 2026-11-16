import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { Services } from "@/services";
import { onboardingRecord } from "@/test-fixtures/onboarding";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient, renderWithProviders } from "@/test-utils";

import { SetupCard } from "../setup-card";

jest.mock("@/services", () => ({
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    onboarding: { fetchOnboarding: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchOnboarding = Services.onboarding.fetchOnboarding as jest.MockedFunction<
  typeof Services.onboarding.fetchOnboarding
>;

/** `school_admin`'s setup keys (`school_organization/permissions.py`). */
const SCHOOL_ADMIN: PermissionKey[] = [
  "school.settings.view",
  "school.settings.update",
  "school.campus.create",
  "school.academic-session.create",
  "school.academic-session.activate",
  "school.class.create",
  "school.section.create",
  "school.subject.create",
];

function renderCard() {
  renderWithProviders(
    <>
      <SetupCard />
      <UserLoaded />
    </>,
  );
}

describe("setup card", () => {
  beforeEach(() => {
    mockFetchCurrentUser.mockReset().mockResolvedValue(buildUser(SCHOOL_ADMIN));
    mockFetchOnboarding.mockReset();
  });

  it("shows the progress and links to the first step the viewer can act on", async () => {
    mockFetchOnboarding.mockResolvedValue(
      onboardingRecord({ done: ["profile", "campuses"], skipped: ["students"] }),
    );

    renderCard();

    expect(await screen.findByText("Finish setting up")).toBeInTheDocument();
    expect(screen.getByText("3 of 9 steps done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
      "aria-valuenow",
      "33",
    );
    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute(
      "href",
      "/setup?step=academic_session",
    );
  });

  it("is hidden once setup is completed", async () => {
    mockFetchOnboarding.mockResolvedValue(
      onboardingRecord({
        done: ["profile", "campuses", "academic_session", "classes", "subjects", "go_live"],
        skipped: ["fee_structures", "staff_invites", "students"],
        completedAt: "2026-11-16T10:00:00Z",
      }),
    );

    renderCard();

    await screen.findByText(USER_LOADED);
    await waitFor(() => {
      expect(mockFetchOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });

  it("stays hidden after going live even if a step later comes undone", async () => {
    mockFetchOnboarding.mockResolvedValue(
      onboardingRecord({ done: ["profile"], completedAt: "2026-11-16T10:00:00Z" }),
    );

    renderCard();

    await screen.findByText(USER_LOADED);
    await waitFor(() => {
      expect(mockFetchOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });

  it("is hidden for an it_admin with no remaining step of theirs", async () => {
    // `it_admin` holds the settings keys but no structure key: with the profile confirmed,
    // every step left needs someone else.
    mockFetchCurrentUser.mockResolvedValue(
      buildUser(["school.settings.view", "school.settings.update"]),
    );
    mockFetchOnboarding.mockResolvedValue(onboardingRecord({ done: ["profile"] }));

    renderCard();

    await screen.findByText(USER_LOADED);
    await waitFor(() => {
      expect(mockFetchOnboarding).toHaveBeenCalled();
    });
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });

  it("never asks for the checklist without the settings view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["school.campus.create"]));

    renderCard();

    await screen.findByText(USER_LOADED);
    expect(mockFetchOnboarding).not.toHaveBeenCalled();
    expect(screen.queryByText("Finish setting up")).not.toBeInTheDocument();
  });

  it("reads the checklist afresh each time it mounts, since other screens change it", async () => {
    mockFetchOnboarding.mockResolvedValue(onboardingRecord({ done: ["profile"] }));
    const { rerender } = renderWithClient(<SetupCard />);
    expect(await screen.findByText("1 of 9 steps done")).toBeInTheDocument();

    // A linked step (fees, staff, students) was finished elsewhere; the card comes back.
    mockFetchOnboarding.mockResolvedValue(onboardingRecord({ done: ["profile", "campuses"] }));
    rerender(<></>);
    rerender(<SetupCard />);

    expect(await screen.findByText("2 of 9 steps done")).toBeInTheDocument();
    expect(mockFetchOnboarding).toHaveBeenCalledTimes(2);
  });
});
