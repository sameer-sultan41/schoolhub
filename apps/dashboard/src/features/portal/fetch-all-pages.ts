import { isCursorPagination, type Page } from "@schoolhub/types";

// A child's own lists are small; the cap is a guard against a server that never ends.
const MAX_PAGES = 20;

/** Every row of a cursor-paged list: a parent sees a child's whole month, term or year, not
 * the first page of it. */
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
    if (!next) break;
    cursor = next;
  }
  return rows;
}
