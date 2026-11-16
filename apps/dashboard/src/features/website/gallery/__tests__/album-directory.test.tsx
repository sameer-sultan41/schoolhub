import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { galleryAlbum, pageOf } from "@/features/website/shared/__tests__/content-fixtures";
import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { AlbumDirectory } from "../album-directory";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("@/services", () =>
  jest
    .requireActual<{
      contentServicesMock: () => unknown;
    }>("../../shared/__tests__/content-services-mock")
    .contentServicesMock(),
);

describe("albums directory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/website/gallery?status=archived");
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["website.page.view"]));
    mocked(Services.galleryAlbums.fetchGalleryAlbumPage).mockResolvedValue(
      pageOf([galleryAlbum()]),
    );
  });

  it("filters only by the statuses an album can be in", async () => {
    renderWithProviders(<AlbumDirectory />);
    const user = userEvent.setup();

    await screen.findByText("Science fair 2026");
    // `archived` is no album's status, so a link carrying it reads as every status.
    expect(Services.galleryAlbums.fetchGalleryAlbumPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined }),
    );
    await user.click(screen.getByRole("combobox", { name: "Status" }));

    expect(await screen.findByRole("option", { name: "Draft" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Published" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  });
});
