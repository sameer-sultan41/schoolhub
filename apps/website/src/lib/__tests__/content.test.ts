import type * as ReactModule from "react";
import { ContentFetchError, readJson } from "../api";
import {
  getAlbum,
  getClasses,
  getDepartments,
  getEvent,
  getEvents,
  getGallery,
  getNews,
  getNewsPost,
  getNotices,
  getPage,
  getPublishedPaths,
  getSite,
  getTeachers,
  PUBLIC_LIST_MAX,
  toPageSlug,
} from "../content";
import { getPreviewToken, markPreviewServed } from "../preview";

jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));
jest.mock("../api", () => ({
  ContentFetchError: class ContentFetchError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  readJson: jest.fn(),
  tenantTag: (id: string) => `tenant:${id}`,
  hostTag: (host: string) => `tenant-host:${host}`,
  pageTag: (id: string, path: string) => `tenant:${id}:page:${path || "/"}`,
}));

jest.mock("../preview", () => ({ getPreviewToken: jest.fn(), markPreviewServed: jest.fn() }));

const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;
const mockGetPreviewToken = getPreviewToken as jest.MockedFunction<typeof getPreviewToken>;
const mockMarkPreviewServed = markPreviewServed as jest.MockedFunction<typeof markPreviewServed>;
const HOST = "cityschool.schoolhub.pk";

beforeEach(() => {
  mockReadJson.mockReset();
  mockGetPreviewToken.mockReset().mockResolvedValue(null);
  mockMarkPreviewServed.mockReset();
});

describe("toPageSlug", () => {
  it("joins segments into a slug", () => {
    expect(toPageSlug(["about", "history"])).toBe("about/history");
  });

  it("is the empty string for the homepage", () => {
    expect(toPageSlug(undefined)).toBe("");
    expect(toPageSlug([])).toBe("");
  });

  it("drops empty segments", () => {
    expect(toPageSlug(["about", ""])).toBe("about");
  });
});

// Every machine read names the host and the final path of website-cms §16, and is tagged
// with the tenant (publish webhook) and the host (domain-change webhook) so either evicts it.
describe("every read sends the host to its contract path", () => {
  it.each([
    ["getPage", () => getPage("t1", HOST, "about"), "/public/pages"],
    ["getSite", () => getSite("t1", HOST), "/public/site"],
    ["getPublishedPaths", () => getPublishedPaths("t1", HOST), "/public/sitemap"],
    ["getTeachers", () => getTeachers("t1", HOST), "/public/teachers"],
    ["getDepartments", () => getDepartments("t1", HOST), "/public/departments"],
    ["getClasses", () => getClasses("t1", HOST), "/public/classes"],
    ["getEvents", () => getEvents("t1", HOST), "/public/school-events"],
    ["getNews", () => getNews("t1", HOST), "/public/news-posts"],
    ["getNotices", () => getNotices("t1", HOST), "/public/notices"],
    ["getGallery", () => getGallery("t1", HOST), "/public/gallery-items"],
    ["getNewsPost", () => getNewsPost("t1", HOST, "sports-day"), "/public/news-posts/sports-day"],
    ["getEvent", () => getEvent("t1", HOST, "sports-day"), "/public/school-events/sports-day"],
    ["getAlbum", () => getAlbum("t1", HOST, "sports-day"), "/public/gallery-albums/sports-day"],
  ])("%s", async (_name, call, path) => {
    mockReadJson.mockResolvedValue(null);
    await call();
    expect(mockReadJson).toHaveBeenCalledTimes(1);
    expect(mockReadJson).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        host: HOST,
        tags: expect.arrayContaining(["tenant:t1", `tenant-host:${HOST}`]),
      }),
    );
  });
});

describe("getPage", () => {
  it("omits the slug for the homepage (slug=home is a 404 by contract)", async () => {
    mockReadJson.mockResolvedValue(null);
    await getPage("t1", HOST, "");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/pages",
      expect.objectContaining({ query: { slug: undefined } }),
    );
  });

  it("sends a nested slug as is", async () => {
    mockReadJson.mockResolvedValue(null);
    await getPage("t1", HOST, "about/history");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/pages",
      expect.objectContaining({
        query: { slug: "about/history" },
        tags: ["tenant:t1", `tenant-host:${HOST}`, "tenant:t1:page:about/history"],
      }),
    );
  });

  it("returns the page content on a hit", async () => {
    mockReadJson.mockResolvedValue({ id: "p1" });
    await expect(getPage("t1", HOST, "about")).resolves.toEqual({ id: "p1" });
  });
});

describe("preview", () => {
  const draft = { id: "draft" };
  const published = { id: "published" };

  it.each([
    ["getPage", "/public/pages", () => getPage("t1", HOST, "about")],
    ["getSite", "/public/site", () => getSite("t1", HOST)],
  ])("%s reads the draft with the cookie's token, uncached", async (_name, path, call) => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson.mockResolvedValue(draft);

    await expect(call()).resolves.toBe(draft);
    expect(mockReadJson).toHaveBeenCalledTimes(1);
    expect(mockReadJson).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ previewToken: "tok-1" }),
    );
  });

  it("marks the render as a preview only when the page read itself was served as one", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson.mockResolvedValue(draft);

    await getPage("t1", HOST, "about");
    expect(mockMarkPreviewServed).toHaveBeenCalledTimes(1);
  });

  it("does not mark a preview for the site read: a token for another page still opens it", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson.mockResolvedValue(draft);

    await getSite("t1", HOST);
    expect(mockMarkPreviewServed).not.toHaveBeenCalled();
  });

  it("does not mark a preview without a cookie", async () => {
    mockReadJson.mockResolvedValue(published);
    await getPage("t1", HOST, "about");
    expect(mockMarkPreviewServed).not.toHaveBeenCalled();
  });

  it("does not mark a preview when the read falls back to published (404)", async () => {
    mockGetPreviewToken.mockResolvedValue("junk");
    mockReadJson.mockResolvedValueOnce(null).mockResolvedValueOnce(published);

    await expect(getPage("t1", HOST, "about")).resolves.toBe(published);
    expect(mockMarkPreviewServed).not.toHaveBeenCalled();
  });

  it("does not mark a preview when the read falls back to published (429)", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson
      .mockRejectedValueOnce(new ContentFetchError("throttled", 429))
      .mockResolvedValueOnce(published);

    await expect(getPage("t1", HOST, "about")).resolves.toBe(published);
    expect(mockMarkPreviewServed).not.toHaveBeenCalled();
  });

  it("stays the cached, tagged published read without a preview cookie", async () => {
    mockReadJson.mockResolvedValue(published);

    await expect(getPage("t1", HOST, "about")).resolves.toBe(published);
    expect(mockReadJson).toHaveBeenCalledTimes(1);
    const options = mockReadJson.mock.calls[0]?.[1];
    expect(options).not.toHaveProperty("previewToken");
    expect(options?.tags).toContain("tenant:t1");
  });

  it("falls back to the cached published read when the API refuses the token", async () => {
    // An expired, forged or other page's token: the API answers 404 to the preview read.
    mockGetPreviewToken.mockResolvedValue("junk");
    mockReadJson.mockResolvedValueOnce(null).mockResolvedValueOnce(published);

    await expect(getPage("t1", HOST, "about")).resolves.toBe(published);
    expect(mockReadJson).toHaveBeenCalledTimes(2);
    const fallback = mockReadJson.mock.calls[1]?.[1];
    expect(fallback).not.toHaveProperty("previewToken");
    expect(fallback?.tags).toContain("tenant:t1");
  });

  it("falls back to the published read when preview reads are throttled", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson
      .mockRejectedValueOnce(new ContentFetchError("throttled", 429))
      .mockResolvedValueOnce(published);

    await expect(getSite("t1", HOST)).resolves.toBe(published);
  });

  it("does not hide any other failure of the preview read", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson.mockRejectedValueOnce(new ContentFetchError("down", 503));

    await expect(getPage("t1", HOST, "about")).rejects.toThrow("down");
  });

  it("never sends it on a module read", async () => {
    mockGetPreviewToken.mockResolvedValue("tok-1");
    mockReadJson.mockResolvedValue(null);
    await getNews("t1", HOST);
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/news-posts",
      expect.not.objectContaining({ previewToken: expect.anything() }),
    );
  });
});

describe("detail readers", () => {
  it("tag the item so a publish of it can be evicted", async () => {
    mockReadJson.mockResolvedValue(null);
    await getNewsPost("t1", HOST, "sports-day");
    expect(mockReadJson).toHaveBeenCalledWith("/public/news-posts/sports-day", {
      host: HOST,
      tags: ["tenant:t1", `tenant-host:${HOST}`, "tenant:t1:news-posts:sports-day"],
    });
  });

  it.each(["..", "a/b", "Sports-Day", "sports day", "", "-x"])(
    "never fetch a slug that cannot exist (%p)",
    async (slug) => {
      await expect(getNewsPost("t1", HOST, slug)).resolves.toBeNull();
      await expect(getEvent("t1", HOST, slug)).resolves.toBeNull();
      await expect(getAlbum("t1", HOST, slug)).resolves.toBeNull();
      expect(mockReadJson).not.toHaveBeenCalled();
    },
  );

  it("return the item on a hit", async () => {
    mockReadJson.mockResolvedValue({ id: "a1" });
    await expect(getAlbum("t1", HOST, "annual-day")).resolves.toEqual({ id: "a1" });
  });
});

describe("getSite", () => {
  it("returns null when the site is not available", async () => {
    mockReadJson.mockResolvedValue(null);
    await expect(getSite("t1", HOST)).resolves.toBeNull();
  });
});

describe("list readers default to an empty array on a miss", () => {
  it.each([
    ["getPublishedPaths", () => getPublishedPaths("t1", HOST)],
    ["getTeachers", () => getTeachers("t1", HOST)],
    ["getDepartments", () => getDepartments("t1", HOST)],
    ["getClasses", () => getClasses("t1", HOST)],
    ["getEvents", () => getEvents("t1", HOST)],
    ["getNews", () => getNews("t1", HOST)],
    ["getNotices", () => getNotices("t1", HOST)],
    ["getGallery", () => getGallery("t1", HOST)],
  ])("%s", async (_name, call) => {
    mockReadJson.mockResolvedValue(null);
    await expect(call()).resolves.toEqual([]);
  });

  it("returns the API's list on a hit", async () => {
    mockReadJson.mockResolvedValue([{ id: "d1" }]);
    await expect(getDepartments("t1", HOST)).resolves.toEqual([{ id: "d1" }]);
  });
});

describe("paginated readers", () => {
  it("asks for upcoming events by default, with the requested page_size", async () => {
    mockReadJson.mockResolvedValue([]);
    await getEvents("t1", HOST, 3);
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/school-events",
      expect.objectContaining({ query: { scope: "upcoming", page_size: 3 } }),
    );
  });

  it("passes a past scope through", async () => {
    mockReadJson.mockResolvedValue([]);
    await getEvents("t1", HOST, 6, "past");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/school-events",
      expect.objectContaining({ query: { scope: "past", page_size: 6 } }),
    );
  });

  it("defaults the page size when none is given", async () => {
    mockReadJson.mockResolvedValue([]);
    await getTeachers("t1", HOST);
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/teachers",
      expect.objectContaining({ query: { page_size: 12 } }),
    );
  });

  it("clamps page_size to the API's 1..50 range", async () => {
    mockReadJson.mockResolvedValue([]);
    await getGallery("t1", HOST, 60);
    await getNews("t1", HOST, 0);
    expect(mockReadJson).toHaveBeenNthCalledWith(
      1,
      "/public/gallery-items",
      expect.objectContaining({ query: { page_size: PUBLIC_LIST_MAX } }),
    );
    expect(mockReadJson).toHaveBeenNthCalledWith(
      2,
      "/public/news-posts",
      expect.objectContaining({ query: { page_size: 1 } }),
    );
  });
});
