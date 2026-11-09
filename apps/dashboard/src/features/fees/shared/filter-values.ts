import { FILTER_ALL } from "@/lib/constants";

/**
 * A URL filter's value as `FilterSelect` holds it, and back: the URL says `"all"` for no filter,
 * the select says `""`.
 */
export const filterToPick = (filter: string) => (filter === FILTER_ALL ? "" : filter);
export const pickToFilter = (pick: string) => (pick === "" ? FILTER_ALL : pick);
