/**
 * Between the API's timestamps (ISO 8601, UTC) and the browser's `datetime-local` and `date`
 * inputs, which hold the viewer's own local time with no zone. Shared by every form with a
 * date-time input (exam marks-entry windows, website events).
 *
 * The local time is the browser's own zone, not the school's: the dashboard does not know the
 * tenant's time zone yet. A value entered from another zone is stored shifted by the difference,
 * and an all-day event entered there can land on the adjacent day (`docs/deferred-work.md`).
 */

/** The browser's `datetime-local` value is `YYYY-MM-DDTHH:mm`: its first 16 characters. */
export const DATETIME_LOCAL_LENGTH = 16;
/** A `date` input's value is `YYYY-MM-DD`: a `datetime-local` value's first 10 characters. */
export const DATE_INPUT_LENGTH = 10;

/** An API timestamp -> a `datetime-local` input's value, in the viewer's own time zone. */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, DATETIME_LOCAL_LENGTH);
}

/** A `datetime-local` value (local time) -> the API's timestamp; blank clears it. */
export function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An API timestamp -> a `date` input's value: the local calendar day it falls on. */
export function isoToLocalDate(value: string | null | undefined): string {
  return isoToLocalInput(value).slice(0, DATE_INPUT_LENGTH);
}

/** A `date` value -> the API's timestamp of that day's local midnight; blank clears it. A bare
 * `YYYY-MM-DD` would parse as UTC midnight, so the time is added to read it as local. */
export function localDateToIso(value: string): string | null {
  return value === "" ? null : localInputToIso(`${value}T00:00`);
}
