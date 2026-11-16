import type * as ReactModule from "react";
import { readJson } from "../api";
import {
  getClasses,
  getDepartments,
  getEvents,
  getGallery,
  getNews,
  getNotices,
  getPage,
  getPublishedPaths,
  getSite,
  getTeachers,
  PUBLIC_LIST_MAX,
  toPageSlug,
} from "../content";

jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));
jest.mock("../api", () => ({
  readJson: jest.fn(),
  tenantTag: (id: string) => `tenant:${id}`,
  hostTag: (host: string) => `tenant-host:${host}`,
  pageTag: (id: string, path: string) => `tenant:${id}:page:${path || "/"}`,
}));

const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;
const HOST = "cityschool.schoolhub.pk";

beforeEach(() => {
  mockReadJson.mockReset();
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
