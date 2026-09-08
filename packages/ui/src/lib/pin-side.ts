/**
 * TanStack Table's column-pinning API only knows `'left' | 'right' | false` — this
 * package's own surface never says so. `'left'` means "pinned to the start", `'right'`
 * means "pinned to the end", and the rendering side (`data-grid-table.tsx`) positions
 * them with logical `insetInlineStart`/`insetInlineEnd` rather than physical offsets, so
 * a column pinned "to start" sticks to the reading-direction-leading edge in both `en`
 * (left) and `ur` (right) with no direction check anywhere else in the grid.
 */
export type PinnedSide = "start" | "end" | false;

export function pinnedSide(tanStackPinned: "left" | "right" | false): PinnedSide {
  if (tanStackPinned === "left") return "start";
  if (tanStackPinned === "right") return "end";
  return false;
}

export function tanStackPinValue(side: "start" | "end" | false): "left" | "right" | false {
  if (side === "start") return "left";
  if (side === "end") return "right";
  return false;
}
