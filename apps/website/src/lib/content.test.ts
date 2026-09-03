import type * as ReactModule from "react";
import { readJson } from "./api";
import {
  getClasses,
  getDepartments,
  getEvents,
  getGallery,
  getNews,
  getNotices,
  getPage,
  getPublishedPaths,
  getSiteSettings,
  getTeachers,
  toPageSlug,
} from "./content";

jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));
jest.mock("./api", () => ({
  readJson: jest.fn(),
  tenantTag: (id: string) => `tenant:${id}`,
  pageTag: (id: string, path: string) => `tenant:${id}:page:${path || "/"}`,
}));

const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;

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

describe("getPage", () => {
  it("requests the homepage slug when given an empty string", async () => {
    mockReadJson.mockResolvedValue(null);
    await getPage("t1", "");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/pages",
      expect.objectContaining({ query: { slug: "home" } }),
    );
  });

  it("returns the page content on a hit", async () => {
    mockReadJson.mockResolvedValue({ id: "p1" });
    await expect(getPage("t1", "about")).resolves.toEqual({ id: "p1" });
  });
});

describe("getSiteSettings", () => {
  it("returns null when there are no settings", async () => {
    mockReadJson.mockResolvedValue(null);
    await expect(getSiteSettings("t1")).resolves.toBeNull();
  });
});

describe("list readers default to an empty array on a miss", () => {
  it.each([
    ["getPublishedPaths", () => getPublishedPaths("t1")],
    ["getTeachers", () => getTeachers("t1")],
    ["getDepartments", () => getDepartments("t1")],
    ["getClasses", () => getClasses("t1")],
    ["getEvents", () => getEvents("t1")],
    ["getNews", () => getNews("t1")],
    ["getNotices", () => getNotices("t1")],
    ["getGallery", () => getGallery("t1")],
  ])("%s", async (_name, call) => {
    mockReadJson.mockResolvedValue(null);
    await expect(call()).resolves.toEqual([]);
  });
});

describe("paginated readers", () => {
  it("passes the requested page_size through to the API", async () => {
    mockReadJson.mockResolvedValue([]);
    await getEvents("t1", 3);
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/events",
      expect.objectContaining({ query: { page_size: 3 } }),
    );
  });

  it("defaults the page size when none is given", async () => {
    mockReadJson.mockResolvedValue([]);
    await getTeachers("t1");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/teachers",
      expect.objectContaining({ query: { page_size: 12 } }),
    );
  });
});
