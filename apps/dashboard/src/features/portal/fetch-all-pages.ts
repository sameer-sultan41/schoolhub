import { isCursorPagination, type Page } from "@schoolhub/types";

// A child's own lists are small; the cap is a guard against a server that never ends.
export const MAX_PAGES = 20;

/** Every row of a cursor-paged list: a parent sees a child's whole month, term or year, not
 * the first page of it. A list still going after `MAX_PAGES` throws, so the page shows its
 * load error rather than silently cutting rows off. */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    rows.push(...result.items);
    const next =
      result.pagination && isCursorPagination(result.pagination)
        ? result.pagination.next_cursor
        : null;
    if (!next) return rows;
    cursor = next;
  }
  throw new Error(`The list has more than ${String(MAX_PAGES)} pages; not all rows were read.`);
}
