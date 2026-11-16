import { screen } from "@testing-library/react";
import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders } from "@/test-utils";

import { NavigationEditor } from "@/features/website/navigation/navigation-editor";
import { WebsiteReadGate } from "../website-read-gate";

jest.mock("@/services", () =>
  jest
    .requireActual<{ siteServicesMock: () => unknown }>("./site-services-mock")
    .siteServicesMock(),
);

function renderGated(keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
  mocked(Services.navigationMenus.fetchNavigationMenus).mockResolvedValue([]);
  mocked(Services.websitePages.fetchPublishedWebsitePages).mockResolvedValue([]);
  renderWithProviders(
    <WebsiteReadGate>
      <NavigationEditor />
    </WebsiteReadGate>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("website read gate", () => {
  it("explains, and reads nothing, for a role with the update key but not page.view", async () => {
    renderGated(["website.navigation.update"]);

    expect(
      await screen.findByText("This section needs permission to view the website"),
    ).toBeInTheDocument();
    expect(Services.navigationMenus.fetchNavigationMenus).not.toHaveBeenCalled();
    expect(Services.websitePages.fetchPublishedWebsitePages).not.toHaveBeenCalled();
  });

  it("mounts the screen for a viewer who may read the website", async () => {
    renderGated(["website.page.view", "website.navigation.update"]);

    expect(await screen.findByRole("heading", { name: "Navigation" })).toBeInTheDocument();
    expect(Services.navigationMenus.fetchNavigationMenus).toHaveBeenCalled();
    expect(
      screen.queryByText("This section needs permission to view the website"),
    ).not.toBeInTheDocument();
  });
});
