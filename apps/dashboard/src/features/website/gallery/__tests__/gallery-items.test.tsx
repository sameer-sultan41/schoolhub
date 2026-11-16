import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import {
  ALBUM_ID,
  galleryAlbum,
  galleryItem,
  violation,
} from "@/features/website/shared/__tests__/content-fixtures";
import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { AlbumPage } from "../album-page";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      contentServicesMock: () => unknown;
    }>("../../shared/__tests__/content-services-mock")
    .contentServicesMock(),
);

const gallery = Services.galleryAlbums;
const fetchItems = mocked(gallery.fetchGalleryItems);
const reorderItems = mocked(gallery.reorderGalleryItems);
const createItem = mocked(gallery.createGalleryItem);
const updateItem = mocked(gallery.updateGalleryItem);
const publishAlbum = mocked(gallery.publishGalleryAlbum);
const uploadFile = mocked(Services.files.uploadFile);

/** Every gallery key the seeded `school_admin` holds; item writes use `.update` (§4). */
const EDITOR_KEYS: PermissionKey[] = [
  "website.gallery-album.create",
  "website.gallery-album.update",
  "website.gallery-album.publish",
  "website.gallery-album.delete",
];

const first = galleryItem({
  id: "11111111-1111-4111-8111-111111111111",
  caption: "Opening",
  alt_text: "Pupils at the gate",
});
const second = galleryItem({
  id: "22222222-2222-4222-8222-222222222222",
  caption: "Judging",
  position: 1,
});
const third = galleryItem({
  id: "33333333-3333-4333-8333-333333333333",
  media_type: "video_embed",
  file_id: null,
  embed_url: "https://www.youtube.com/embed/abc",
  caption: "Prize giving",
  position: 2,
});

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["website.page.view", ...keys]),
  );
}

async function renderAlbum() {
  renderWithProviders(
    <>
      <UserLoaded />
      <AlbumPage albumId={ALBUM_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  await screen.findByRole("list", { name: "Album items" });
  return userEvent.setup();
}

/** The captions in the order the grid shows them. */
function shownOrder() {
  return within(screen.getByRole("list", { name: "Album items" }))
    .getAllByRole("listitem")
    .map(
      (tile) =>
        [first, second, third].find((item) => within(tile).queryByText(item.caption))?.caption,
    );
}

describe("gallery items", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl(`/website/gallery/${ALBUM_ID}`);
    asUser(...EDITOR_KEYS);
    mocked(gallery.fetchGalleryAlbum).mockResolvedValue(galleryAlbum());
    fetchItems.mockResolvedValue([first, second, third]);
  });

  it("sends the album's whole order after a move, and shows it", async () => {
    reorderItems.mockResolvedValue([{ ...second, position: 0 }, { ...first, position: 1 }, third]);
    const user = await renderAlbum();

    await user.click(screen.getByRole("button", { name: "Move item 1 later" }));

    expect(reorderItems).toHaveBeenCalledWith(ALBUM_ID, [second.id, first.id, third.id]);
    await waitFor(() => {
      expect(shownOrder()).toEqual(["Judging", "Opening", "Prize giving"]);
    });
    expect(screen.getByRole("button", { name: "Move item 1 earlier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move item 3 later" })).toBeDisabled();
  });

  it("puts the order back and says why when the server refuses it", async () => {
    reorderItems.mockRejectedValue(
      violation("ids", "invalid_item_ids", "list every item of this album exactly once."),
    );
    const user = await renderAlbum();

    await user.click(screen.getByRole("button", { name: "Move item 3 earlier" }));

    expect(
      await screen.findByText(
        "The album changed while you were reordering. Reload it and try again.",
      ),
    ).toBeVisible();
    expect(shownOrder()).toEqual(["Opening", "Judging", "Prize giving"]);
  });

  it("shows a video host the server refuses under the link, in the viewer's words", async () => {
    createItem.mockRejectedValue(
      violation("embed_url", "embed_host_not_allowed", "this video host is not supported."),
    );
    const user = await renderAlbum();

    await user.click(screen.getByRole("button", { name: "Add video" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a video" });
    await user.type(
      within(dialog).getByLabelText("Video link"),
      "https://www.dailymotion.com/video/x1",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Only YouTube and Vimeo videos can be embedded."),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Video link")).toHaveAttribute("aria-invalid", "true");
    expect(createItem).toHaveBeenCalledWith(ALBUM_ID, {
      media_type: "video_embed",
      embed_url: "https://www.dailymotion.com/video/x1",
      caption: "",
      alt_text: "",
    });
  });

  it("refuses a link that is not https before sending it", async () => {
    const user = await renderAlbum();

    await user.click(screen.getByRole("button", { name: "Add video" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a video" });
    await user.type(within(dialog).getByLabelText("Video link"), "http://youtu.be/abc");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Use an https:// link of at most 500 characters."),
    ).toBeVisible();
    expect(createItem).not.toHaveBeenCalled();
  });

  it("flags a photo with no description, and asks for one before saving it", async () => {
    updateItem.mockResolvedValue({ ...second, alt_text: "A judge at a stand" });
    const user = await renderAlbum();

    const tile = screen.getByRole("listitem", { name: "Item 2" });
    expect(within(tile).getByText("Needs a description")).toBeInTheDocument();
    await user.click(within(tile).getByRole("button", { name: "Edit item 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit item" });
    expect(within(dialog).queryByLabelText("Video link")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This field is required.")).toBeVisible();
    expect(updateItem).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByLabelText("Description for screen readers"),
      "A judge at a stand",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateItem).toHaveBeenCalledWith(ALBUM_ID, second.id, {
        caption: "Judging",
        alt_text: "A judge at a stand",
      });
    });
  });

  it("adds several photos in the order picked, listing a failure by its file", async () => {
    uploadFile.mockResolvedValueOnce("file-a").mockRejectedValueOnce(new Error("Too large."));
    createItem.mockResolvedValue(first);
    const user = await renderAlbum();

    const input = screen.getByLabelText("Upload photos", { selector: "input" });
    await user.upload(input, [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]);

    expect(await screen.findByText("b.png: Too large.")).toBeVisible();
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledWith(ALBUM_ID, { media_type: "image", file_id: "file-a" });
    expect(uploadFile).toHaveBeenNthCalledWith(1, expect.any(File), "website.media");
  });

  it("names the server's reason when an empty album can't be published", async () => {
    fetchItems.mockResolvedValue([]);
    publishAlbum.mockRejectedValue(
      violation("items", "empty_album", "add at least one item before publishing."),
    );
    renderWithProviders(<AlbumPage albumId={ALBUM_ID} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Add at least one photo or video before publishing this album.",
      );
    });
  });

  it("offers a viewer with only the read key no change to the items", async () => {
    asUser();
    await renderAlbum();

    expect(screen.queryByRole("button", { name: "Upload photos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add video" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move item 1 later" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});
