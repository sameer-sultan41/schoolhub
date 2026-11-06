import type { Page } from "@schoolhub/types";

import { fetchAllPages, MAX_PAGES } from "../fetch-all-pages";

function page(items: number[], next: string | null): Page<number> {
  return { items, pagination: { next_cursor: next, previous_cursor: null, page_size: 1 } };
}

describe("fetchAllPages", () => {
  it("follows the cursor until the last page and returns every row", async () => {
    const fetchPage = jest
      .fn<Promise<Page<number>>, [string | undefined]>()
      .mockResolvedValueOnce(page([1], "c2"))
      .mockResolvedValueOnce(page([2], null));

    await expect(fetchAllPages(fetchPage)).resolves.toEqual([1, 2]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "c2");
  });

  it("throws, rather than cutting rows off, when the cap is hit with a next cursor left", async () => {
    const fetchPage = jest
      .fn<Promise<Page<number>>, [string | undefined]>()
      .mockResolvedValue(page([1], "more"));

    await expect(fetchAllPages(fetchPage)).rejects.toThrow(/more than 20 pages/);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it("returns the rows when the last allowed page has no next cursor", async () => {
    const fetchPage = jest.fn<Promise<Page<number>>, [string | undefined]>();
    for (let i = 1; i < MAX_PAGES; i += 1)
      fetchPage.mockResolvedValueOnce(page([i], `c${String(i)}`));
    fetchPage.mockResolvedValueOnce(page([MAX_PAGES], null));

    await expect(fetchAllPages(fetchPage)).resolves.toHaveLength(MAX_PAGES);
  });
});
