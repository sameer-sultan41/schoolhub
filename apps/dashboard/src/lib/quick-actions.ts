import type { PermissionKey } from "@schoolhub/types";
import {
  CalendarPlus,
  ClipboardCheck,
  GraduationCap,
  type LucideIcon,
  Upload,
  Users,
} from "lucide-react";

/**
 * The things people come to this app to *start*, as opposed to the screens they navigate
 * to — which is what `nav-items.ts` beside this file holds.
 *
 * Both surfaces that offer actions read this list: the ⌘K palette and the home screen's
 * Quick actions panel. They used to keep a copy each, and the copies had already drifted
 * into different icons for the same three actions. What they legitimately differ in is
 * what they render — the palette puts a subset inside a `CommandGroup`, the panel renders
 * buttons — so this shares the data and neither the markup nor the labels.
 */
export type QuickActionKey =
  "newStudent" | "newStaff" | "importStudents" | "buildTimetable" | "reviewPromotions";

export interface QuickAction {
  /**
   * Message key, resolved per surface: under `dashboard.actions` in the panel and under
   * `nav.command.action` in the palette. The two namespaces carry the same English today
   * and are still separate, because one is a card label and the other a search result.
   */
  key: QuickActionKey;
  href: string;
  /** The key that lets the reader finish the action, not merely open the screen. */
  permission: PermissionKey;
  icon: LucideIcon;
}

/**
 * Icons name the *subject*; the label carries the verb.
 *
 * The two surfaces had drifted onto three different marks for the same three actions —
 * `UserPlus` against `UserRoundPlus` for a new student, `GraduationCap` against
 * `UserRoundPlus` for a new staff member, `FileUp` against `Upload` for the import. They
 * are reconciled onto the vocabulary the rest of the app already speaks rather than onto
 * whichever copy happened to be read last:
 *
 * - `GraduationCap` means students here — `nav-items.ts` and the roster's own empty state
 *   (`features/students/students-table.tsx`) both say so. It therefore cannot also mean
 *   staff, which is what the palette had it doing.
 * - `Users` means staff, on the same two authorities (`nav-items.ts`,
 *   `features/staff/staff-table.tsx`).
 * - `Upload` is the plain import glyph. `FileUp` reads as "send this one document", which
 *   is what the per-record document panels do, not what pulling in a roster does.
 *
 * `UserPlus`/`UserRoundPlus` are gone from both surfaces: a round head against a square
 * one at 16px is not a difference a reader can see, so neither glyph could ever have said
 * which of the two adjacent rows was the one about students.
 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "newStudent",
    href: "/students/new",
    permission: "students.student.create",
    icon: GraduationCap,
  },
  { key: "newStaff", href: "/staff/new", permission: "staff.staff.create", icon: Users },
  {
    key: "importStudents",
    href: "/students/import",
    permission: "students.student.import",
    icon: Upload,
  },
  // The week grid is where a timetable is actually built, and `timetable.slot.create` is
  // what makes it more than a read-only view of someone else's work.
  {
    key: "buildTimetable",
    href: "/timetable",
    permission: "timetable.slot.create",
    icon: CalendarPlus,
  },
  {
    key: "reviewPromotions",
    href: "/academics/promotions",
    permission: "academics.promotion.view",
    icon: ClipboardCheck,
  },
];

/**
 * The palette offers three of the five, and the cut is an i18n fact rather than a taste
 * one: `nav.command.action` names only these three, so a fourth row would render its raw
 * message key in the dialog. Widening this means adding the message first.
 */
const PALETTE_ACTION_KEYS: readonly QuickActionKey[] = ["newStudent", "newStaff", "importStudents"];

export const PALETTE_QUICK_ACTIONS: QuickAction[] = QUICK_ACTIONS.filter((action) =>
  PALETTE_ACTION_KEYS.includes(action.key),
);
