import { matchesPath, mostSpecificPath } from "../active-path";

describe("matchesPath", () => {
  it("matches the path itself and anything under it", () => {
    expect(matchesPath("/exams", "/exams")).toBe(true);
    expect(matchesPath("/exams", "/exams/123")).toBe(true);
  });

  it("does not match a sibling that merely starts with the same letters", () => {
    expect(matchesPath("/exams", "/exams-archive")).toBe(false);
    expect(matchesPath("/exams", "/staff")).toBe(false);
  });

  it("matches the root only on the root", () => {
    expect(matchesPath("/", "/")).toBe(true);
    expect(matchesPath("/", "/exams")).toBe(false);
  });
});

describe("mostSpecificPath", () => {
  const paths = ["/exams", "/exams/grading-scales", "/staff"];

  it("picks the nested path over its parent", () => {
    expect(mostSpecificPath(paths, "/exams/grading-scales")).toBe("/exams/grading-scales");
    expect(mostSpecificPath(paths, "/exams/grading-scales/7")).toBe("/exams/grading-scales");
  });

  it("falls back to the parent on its own and detail pages", () => {
    expect(mostSpecificPath(paths, "/exams")).toBe("/exams");
    expect(mostSpecificPath(paths, "/exams/123")).toBe("/exams");
  });

  it("returns undefined when nothing matches", () => {
    expect(mostSpecificPath(paths, "/exams-archive")).toBeUndefined();
  });
});
