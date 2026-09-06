import { PAGE_WINDOW_SIZE, getPageNumbers } from "./page-numbers";

describe("getPageNumbers", () => {
  it("returns nothing when there is nothing to paginate", () => {
    expect(getPageNumbers(1, 0)).toEqual([]);
    expect(getPageNumbers(1, -3)).toEqual([]);
  });

  it("returns every page when they all fit in the window", () => {
    expect(getPageNumbers(1, 1)).toEqual([1]);
    expect(getPageNumbers(2, 3)).toEqual([1, 2, 3]);
    expect(getPageNumbers(5, PAGE_WINDOW_SIZE)).toEqual([1, 2, 3, 4, 5]);
  });

  it("clamps the window to the start rather than running past page 1", () => {
    expect(getPageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageNumbers(2, 12)).toEqual([1, 2, 3, 4, 5]);
    // Page 3 is the first page that can actually sit in the centre.
    expect(getPageNumbers(3, 12)).toEqual([1, 2, 3, 4, 5]);
  });

  it("centres the window on the current page in the middle of the range", () => {
    expect(getPageNumbers(6, 12)).toEqual([4, 5, 6, 7, 8]);
    expect(getPageNumbers(7, 12)).toEqual([5, 6, 7, 8, 9]);
  });

  it("clamps the window to the end rather than running past the last page", () => {
    expect(getPageNumbers(10, 12)).toEqual([8, 9, 10, 11, 12]);
    expect(getPageNumbers(11, 12)).toEqual([8, 9, 10, 11, 12]);
    expect(getPageNumbers(12, 12)).toEqual([8, 9, 10, 11, 12]);
  });

  it("survives a currentPage below the range by falling back to the first window", () => {
    expect(getPageNumbers(0, 12)).toEqual([1, 2, 3, 4, 5]);
    expect(getPageNumbers(-40, 12)).toEqual([1, 2, 3, 4, 5]);
  });

  it("survives a currentPage above the range by falling back to the last window", () => {
    expect(getPageNumbers(13, 12)).toEqual([8, 9, 10, 11, 12]);
    expect(getPageNumbers(9000, 12)).toEqual([8, 9, 10, 11, 12]);
  });

  it("keeps the window a constant width at every position, so buttons never shuffle", () => {
    for (let page = 1; page <= 12; page += 1) {
      const pages = getPageNumbers(page, 12);
      expect(pages).toHaveLength(PAGE_WINDOW_SIZE);
      expect(pages[0]).toBeGreaterThanOrEqual(1);
      expect(pages.at(-1)).toBeLessThanOrEqual(12);
    }
  });
});
