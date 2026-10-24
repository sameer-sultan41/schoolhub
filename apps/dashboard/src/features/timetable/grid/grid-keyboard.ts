import { KeyboardCode, type KeyboardCoordinateGetter } from "@dnd-kit/core";

import { keyboardStep, type GridDirection } from "./resolve-drop";

const DIRECTION_BY_CODE: Partial<Record<string, GridDirection>> = {
  [KeyboardCode.Up]: "up",
  [KeyboardCode.Down]: "down",
  [KeyboardCode.Left]: "left",
  [KeyboardCode.Right]: "right",
};

/**
 * The keyboard sensor's arrow-key step: to the next cell (`keyboardStep`), not a fixed number
 * of pixels. Directions are physical, as the arrows on the keyboard are: in a right-to-left
 * layout ArrowRight still moves to the cell on the right.
 */
export const gridCoordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers, over } },
) => {
  const direction = DIRECTION_BY_CODE[event.code];
  if (!direction || !collisionRect) return undefined;
  event.preventDefault();

  const cells = droppableContainers.getEnabled().flatMap((container) => {
    const rect = droppableRects.get(container.id);
    return rect ? [{ id: container.id, box: rect }] : [];
  });
  const overRect = over ? droppableRects.get(over.id) : undefined;
  const fromCell = over && overRect ? { id: over.id, box: overRect } : null;
  const step = keyboardStep(collisionRect, fromCell, cells, direction);
  return step ? { x: step.left, y: step.top } : undefined;
};
