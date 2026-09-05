import type { RoomFormValues } from "@/features/timetable/room-schema";

/**
 * Whitelist of server field names the room form has an input for. The uniqueness
 * of `code` within a campus is enforced by a database constraint, which surfaces
 * as a 409 rather than a field error; anything else the serializer names but this
 * form does not render lands in the "root" bucket rather than vanishing silently.
 */
const KNOWN_FIELDS = new Set<keyof RoomFormValues>([
  "campus_id",
  "name",
  "code",
  "room_type",
  "capacity",
  "building",
  "floor",
  "is_active",
]);

export function mapRoomFieldErrors(fieldErrors: Record<string, string>): {
  known: Partial<Record<keyof RoomFormValues, string>>;
  unknown: string[];
} {
  const known: Partial<Record<keyof RoomFormValues, string>> = {};
  const unknown: string[] = [];

  for (const [field, issue] of Object.entries(fieldErrors)) {
    if (KNOWN_FIELDS.has(field as keyof RoomFormValues)) {
      known[field as keyof RoomFormValues] = issue;
    } else {
      unknown.push(issue);
    }
  }

  return { known, unknown };
}
