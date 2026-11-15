import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  LOGO_FILE_ID,
  schoolSettingsRecord,
} from "@/services/modules/school-settings/__tests__/school-settings-fixtures";
import { buildUser, renderWithProviders, setUrl, stubObjectUrls } from "@/test-utils";

import { ProfileSection } from "../profile-section";

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
    files: { uploadFile: jest.fn() },
    schoolSettings: { fetchSchoolSettings: jest.fn(), updateSchoolSettings: jest.fn() },
  },
}));

const settings = Services.schoolSettings as jest.Mocked<typeof Services.schoolSettings>;
const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const CONFIGURER = buildUser(["school.settings.view", "school.settings.update"]);

function renderSection() {
  renderWithProviders(<ProfileSection />);
  return userEvent.setup();
}

/** Renders for the configurer and waits for Save: the fields stay disabled until `/auth/me`
 * says the viewer may update. */
async function renderEditableSection() {
  const user = renderSection();
  await screen.findByRole("button", { name: "Save" });
  return user;
}

function fieldError(field: string, issue: string, status = 400) {
  return new ApiError({
    code: status === 422 ? "domain_rule_violation" : "validation_error",
    message: issue,
    status,
    url: "/school-settings",
    details: [{ field, issue }],
  });
}

describe("profile section", () => {
  beforeEach(() => {
    setUrl("/school/profile");
    mockFetchCurrentUser.mockReset().mockResolvedValue(CONFIGURER);
    settings.fetchSchoolSettings.mockReset().mockResolvedValue(schoolSettingsRecord());
    settings.updateSchoolSettings.mockReset();
    mockUploadFile.mockReset();
  });

  it("saves the name, colour and currency, leaving the untouched logo out", async () => {
    settings.updateSchoolSettings.mockResolvedValue(schoolSettingsRecord({ name: "North" }));
    const user = await renderEditableSection();

    const name = await screen.findByLabelText("School name");
    await user.clear(name);
    await user.type(name, "City School North");
    await user.clear(screen.getByLabelText("Brand colour"));
    await user.type(screen.getByLabelText("Brand colour"), "#123ABC");
    await user.clear(screen.getByLabelText("Currency"));
    await user.type(screen.getByLabelText("Currency"), "usd");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(settings.updateSchoolSettings).toHaveBeenCalledWith({
        name: "City School North",
        branding: { primary_color: "#123ABC" },
        timezone: "Asia/Karachi",
        locale: "en",
        currency: "USD",
      });
    });
  });

  it("refreshes /auth/me after a rename, since it names the school", async () => {
    settings.updateSchoolSettings.mockResolvedValue(schoolSettingsRecord({ name: "North" }));
    const user = await renderEditableSection();

    const name = await screen.findByLabelText("School name");
    await user.clear(name);
    await user.type(name, "North");
    const readsBefore = mockFetchCurrentUser.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockFetchCurrentUser.mock.calls.length).toBeGreaterThan(readsBefore);
    });
  });

  it("shows the server's colour error under the colour, though it names branding", async () => {
    const issue = "Enter a hex colour such as #1E88E5.";
    settings.updateSchoolSettings.mockRejectedValue(fieldError("branding.primary_color", issue));
    const user = await renderEditableSection();

    const name = await screen.findByLabelText("School name");
    await user.type(name, " Trust");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.getByLabelText("Brand colour")).toHaveAttribute("aria-invalid", "true");
  });

  it("uploads a new logo and shows the server's 422 for it under the logo", async () => {
    const restoreUrls = stubObjectUrls("blob:logo");
    const issue = "This file is not a ready school logo upload.";
    mockUploadFile.mockResolvedValue(LOGO_FILE_ID);
    settings.updateSchoolSettings.mockRejectedValue(fieldError("logo_file_id", issue, 422));
    const user = await renderEditableSection();

    await user.upload(
      await screen.findByLabelText("Logo"),
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.any(File), "school.logo");
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(settings.updateSchoolSettings).toHaveBeenCalledWith(
      expect.objectContaining({ logo_file_id: LOGO_FILE_ID }),
    );
    restoreUrls();
  });

  it("removes a saved logo by sending null", async () => {
    settings.fetchSchoolSettings.mockResolvedValue(
      schoolSettingsRecord({ logo_file_id: LOGO_FILE_ID }),
    );
    settings.updateSchoolSettings.mockResolvedValue(schoolSettingsRecord());
    const user = await renderEditableSection();

    await user.click(await screen.findByRole("button", { name: "Remove logo" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(settings.updateSchoolSettings).toHaveBeenCalledWith(
        expect.objectContaining({ logo_file_id: null }),
      );
    });
  });

  it("refuses a currency that is not three letters before sending", async () => {
    const user = await renderEditableSection();

    const currency = await screen.findByLabelText("Currency");
    await user.clear(currency);
    await user.type(currency, "P1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a three-letter currency code.")).toBeInTheDocument();
    expect(settings.updateSchoolSettings).not.toHaveBeenCalled();
  });

  it("is read only, and says so, without the update key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["school.settings.view"]));
    settings.fetchSchoolSettings.mockResolvedValue(
      schoolSettingsRecord({ logo_file_id: LOGO_FILE_ID }),
    );

    renderSection();

    expect(
      await screen.findByText("You can view these settings but not change them."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    // No input takes an edit, and the logo picker can't start an upload.
    expect(screen.getByLabelText("Logo")).toBeDisabled();
    expect(screen.getByLabelText("School name")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Remove logo" })).not.toBeInTheDocument();
  });

  it("says when the profile can't be loaded", async () => {
    settings.fetchSchoolSettings.mockRejectedValue(new Error("offline"));

    renderSection();

    expect(await screen.findByText("The school profile couldn't be loaded.")).toBeInTheDocument();
  });
});
