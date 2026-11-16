import type { Locator } from "@playwright/test";
import { BasePage } from "../../base.page";

/**
 * The Website content screens: `/website/news`, `/website/events`, `/website/gallery` and an
 * album's page (`/website/gallery/{id}`). Each directory's table is named by its caption; a
 * record opens from its title. See `apps/dashboard/src/features/website/{news,events,gallery}/`.
 */
export class WebsiteContentPage extends BasePage {
  readonly path = "/website/news";

  async gotoEvents(): Promise<void> {
    await this.goto({ path: "/website/events" });
  }

  async gotoGallery(): Promise<void> {
    await this.goto({ path: "/website/gallery" });
  }

  async gotoAlbum(albumId: string): Promise<void> {
    await this.goto({ path: `/website/gallery/${albumId}` });
  }

  /** A directory by its caption: "News posts", "Events" or "Gallery albums". */
  table(caption: string): Locator {
    return this.page.getByRole("table", { name: caption, exact: true });
  }

  row(caption: string, title: string): Locator {
    return this.table(caption).getByRole("row").filter({ hasText: title });
  }

  /** The open create/edit dialog or detail sheet, by its title. */
  dialog(name: string): Locator {
    return this.page.getByRole("dialog", { name });
  }

  /** An album's photos and videos, in the order the website shows them. */
  get albumItems(): Locator {
    return this.page.getByRole("list", { name: "Album items" });
  }

  albumItem(position: number): Locator {
    return this.albumItems.getByRole("listitem", { name: `Item ${position}`, exact: true });
  }
}
