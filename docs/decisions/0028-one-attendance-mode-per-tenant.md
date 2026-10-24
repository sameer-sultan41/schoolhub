# 0028. One attendance mode per tenant; period registers widen the markers; reports count derived days

- **Status:** Accepted
- **Date:** 2026-10-24
- **Enforced by:** `apps/api/apps/attendance/tests/test_attendance_mode.py` (the setting, the mode gate, the period markers, leave, lateness, alerts and derived days), `apps/api/apps/attendance/tests/test_marking.py` (rows written under the other mode survive a switch), `apps/api/apps/examinations/tests/test_report_cards.py` (a period-mode report card counts days); that a new student report reads `reports.derived_days` is review only

## Context

`attendance.md` §19 names `attendance_mode` (`daily` or `period`), but nothing switched it:
`period_id` was accepted on any submission, only the class teacher could mark, reports counted
rows, and lateness ran from the day's start. A secondary-school class teacher teaches perhaps one
period a day, so period mode with §11's class-teacher-only rule cannot be operated. And a report
that counts rows changes unit the day a school switches, so its report cards and defaulter lists
stop comparing with its own history. The user decided the marker widening and the reporting unit
on 2026-10-24 (plan `docs/superpowers/plans/2026-10-24-attendance-dashboard.md`).

## Decision

1. **One mode per tenant.** `tenant_settings.academic.attendance_mode` is `daily` (the default,
   and the reading of anything missing or unknown) or `period`, read by
   `services.attendance_mode()` and written by `PATCH /attendance-settings`. Switching to `period`
   is refused (422) while `module.timetable` is off. `bulk_mark_student_attendance` refuses a
   `period_id` in daily mode and requires one in period mode; a break, or a period with no
   effective lesson for the section that date, is refused. The register read applies the same
   gate. The importer and approved-leave auto-marking stay mode-agnostic and write daily rows.
   Rows written under the other mode stay readable and are never overwritten.
2. **Period markers (amends §11).** `register.may_mark_register` allows `all` scope, `campus`
   scope on the section's campus, and, with `assigned` scope, the section's class teacher or the
   teacher of the section's lesson in that period on that date. A confirmed substitute
   *replaces* the absent teacher for that date. "Who taught it that date" is always the
   version-aware, cover-aware timetable (`timetable.slots.services.effective_slots_for`), never
   today's published grid.
3. **Reports count derived days.** `reports.derived_days` turns a student's rows for a date into
   one day: a daily row is the day; otherwise all periods absent is `absent`, any absent is
   `half_day`, the earliest marked period late is `late` with its minutes, all excused is
   `excused`, else `present`. Every student report reads it, and so do report cards, through
   `reports.student_summary`.

Around these: a student with a daily `on_leave` row is refused in every period register (a
`meta.rows` issue, so no absence alert goes); a period row's lateness runs from its period's
start, with the tenant's grace minutes, in marking and in correction approval; guardian alerts
are deduplicated per (student, date, event) across every row that date.

## Alternatives considered

- **Both modes side by side** (daily and period rows on the same date) — why not: two registers
  disagree about whether a student was present, and every report must pick one anyway.
- **Class teacher only marks periods** — why not: the class teacher of a secondary section is not
  in the room for most of its periods (user, 2026-10-24).
- **Teacher-subject allocations as the marking scope** — why not: an allocation says a teacher
  teaches the subject this session, not that they hold this period today.
- **Today's published grid for the marker check** — why not: a republish end-dates the old cells,
  so a past date inside the lock window would authorise the wrong teacher.
- **The absent teacher keeps marking a covered period** — why not: two people would hold one
  register; the substitute is the one in the room (user, 2026-10-24).
- **Count periods in reports** — why not: report cards change unit, and a month of daily history
  before a switch no longer compares with what follows (user, 2026-10-24). Converting period
  attendance to a daily value is how SIS products report it.
- **Materialise derived days into a table** — why not: a second copy that a correction or a late
  leave approval would have to keep in step; the derivation runs once per report.
- **Edit the mode through `/school-settings`** — why not: its PATCH replaces the whole `academic`
  JSON, so a client read-modify-write loses a concurrent change.

## Consequences

- A tenant that switches keeps both halves of its history readable, and its reports keep one
  unit. A daily row on a period-mode date (leave, an import) wins over that date's period rows.
- A half-day leave writes a daily row and so blocks every period that day; mapping a half to
  periods by start time is deferred.
- The derivation runs in SQL: the scoped queryset's rows are wrapped as a CTE, grouped per
  (student, date) into days, then per student, with a defaulter threshold and the row cap applied
  in the same statement. Python receives one row per report row, so the inline cap bounds the
  work as well as the output.
- `attendance_rate` is rounded in SQL, half up (`ROUND(..., 1)`), as examinations' percentages
  are (`examinations/grading.py`); the earlier Python rounding was half to even, and the two
  differ only on an exact `.x5` percentage.
- Period mode depends on `module.timetable`. Switching to period mode is refused while it is off.
  Turning it off after switching is not refused (platform admin owns the toggle), but
  `assert_register_period` then refuses every period register, read and `:bulk-mark` alike (422
  on `period_id`), until it is back on or the mode is switched to daily.
