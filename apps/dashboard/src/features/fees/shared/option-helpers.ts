/**
 * A picker's choices: the active records, plus the one the form already holds (an edit whose saved
 * account or category has since been deactivated keeps it, so the select is never blanked).
 */
export function activeOrCurrent<T extends { id: string; is_active?: boolean }>(
  records: readonly T[],
  currentId: string,
): T[] {
  return records.filter((record) => record.is_active !== false || record.id === currentId);
}
