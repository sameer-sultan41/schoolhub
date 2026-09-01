/**
 * Cross-component constants shared within this package. Add here only what more than one
 * component needs, or what an inline literal would otherwise leave unnamed — one-off,
 * single-use values stay local to their component.
 */

/** Elements DataTable's clickable-row handlers treat as "already interactive" — a click or
 * keydown originating from one of these must not also trigger the row's own onRowClick. */
export const INTERACTIVE_ELEMENT_SELECTOR = "button, a, input, select, textarea";

/** Placeholder row count DataTable renders while `isLoading` is true. */
export const DEFAULT_SKELETON_ROW_COUNT = 3;
