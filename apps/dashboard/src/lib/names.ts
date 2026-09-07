/**
 * Rendering people's names.
 *
 * Lifted out of `components/user-menu.tsx`, unchanged, once the tables needed the same
 * thing: a roster with an avatar in every row is the second caller, and a private copy
 * in a component file is not somewhere the third one would find it.
 */

/**
 * "Ayesha Khan" → "AK". First and last only: a middle initial in a 32px circle is noise,
 * and a single-word name still gets one letter rather than an empty disc.
 */
export function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  // charAt rather than [0]: it returns "" past the end instead of undefined, so an empty
  // name produces an empty disc rather than a broken one.
  return `${first.charAt(0)}${last?.charAt(0) ?? ""}`.toUpperCase();
}
