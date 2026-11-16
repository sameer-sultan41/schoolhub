import { z } from "zod";

import {
  boundedText,
  contentFieldSchemas,
  type ContentFieldMessages,
} from "@/features/website/shared/content-fields";
import { emptyRichText, toRichText, toRichTextPayload } from "@/features/website/shared/rich-text";
import {
  DATE_INPUT_LENGTH,
  isoToLocalDate,
  isoToLocalInput,
  localDateToIso,
  localInputToIso,
} from "@/lib/date-time-input";
import type { SchoolEventDetail, SchoolEventInput } from "@/services";
import { EVENT_LOCATION_MAX } from "@/services/modules/website/school-events/school-events-constant";

/**
 * The event form, with the API's own field names. `starts_at`/`ends_at` hold the inputs' local
 * values: a `date` (`YYYY-MM-DD`) for an all-day event, else a `datetime-local`. `ends_at` is
 * `""` for an event with no end.
 */

export interface EventFormMessages extends ContentFieldMessages {
  startRequired: string;
  endBeforeStart: string;
}

/** An input's value as the API's timestamp, read by the event's own kind. */
export function eventInputToIso(value: string, isAllDay: boolean): string | null {
  return isAllDay ? localDateToIso(value) : localInputToIso(value);
}

/** The inputs' values carried across an all-day switch: the day is kept, a time starts at
 * midnight. */
export function switchAllDay(value: string, isAllDay: boolean): string {
  if (value === "") return "";
  return isAllDay
    ? value.slice(0, DATE_INPUT_LENGTH)
    : `${value.slice(0, DATE_INPUT_LENGTH)}T00:00`;
}

/** The fields the date check reads: it runs whenever these parse, whatever the others hold. */
const eventDates = z.object({
  is_all_day: z.boolean(),
  starts_at: z.string(),
  ends_at: z.string(),
});

export function eventFormSchema(messages: EventFormMessages) {
  const fields = contentFieldSchemas(messages);
  return z
    .object({
      title: fields.title,
      slug: fields.slug,
      is_all_day: z.boolean(),
      starts_at: z.string(),
      ends_at: z.string(),
      location: boundedText(messages, EVENT_LOCATION_MAX),
      cover_image_file_id: z.string(),
      description: fields.richText,
    })
    .superRefine(
      (values, ctx) => {
        const issue = eventDatesIssue(values, messages);
        if (issue) ctx.addIssue({ code: "custom", ...issue });
      },
      { when: (payload) => eventDates.safeParse(payload.value).success },
    );
}

/** The server's `end_before_start` rule, checked here first so it never needs a round trip;
 * also a start that is blank or unreadable. `null` when the dates are fine. */
export function eventDatesIssue(
  values: z.infer<typeof eventDates>,
  messages: Pick<EventFormMessages, "startRequired" | "endBeforeStart">,
): { path: ["starts_at" | "ends_at"]; message: string } | null {
  const startsAt = eventInputToIso(values.starts_at, values.is_all_day);
  if (startsAt === null) return { path: ["starts_at"], message: messages.startRequired };
  const endsAt = eventInputToIso(values.ends_at, values.is_all_day);
  if (endsAt !== null && Date.parse(endsAt) < Date.parse(startsAt)) {
    return { path: ["ends_at"], message: messages.endBeforeStart };
  }
  return null;
}

export type EventFormValues = z.infer<ReturnType<typeof eventFormSchema>>;

/** The inputs a server error can name; a description error is mapped by its block path. */
export const EVENT_FORM_FIELDS = [
  "title",
  "slug",
  "is_all_day",
  "starts_at",
  "ends_at",
  "location",
  "cover_image_file_id",
  "description",
];

export function eventFormDefaults(): EventFormValues {
  return {
    title: "",
    slug: "",
    is_all_day: false,
    starts_at: "",
    ends_at: "",
    location: "",
    cover_image_file_id: "",
    description: emptyRichText(),
  };
}

export function eventDetailToFormValues(detail: SchoolEventDetail): EventFormValues {
  const toInput = detail.is_all_day ? isoToLocalDate : isoToLocalInput;
  return {
    title: detail.title,
    slug: detail.slug,
    is_all_day: detail.is_all_day,
    starts_at: toInput(detail.starts_at),
    ends_at: toInput(detail.ends_at),
    location: detail.location,
    cover_image_file_id: detail.cover_image_file_id ?? "",
    description: toRichText(detail.description),
  };
}

/**
 * The create or update body. No end is `null` (the column is nullable); no cover is an omitted
 * key on create (the API refuses an empty id) and `null` on edit, which clears the saved one.
 */
export function buildEventInput(
  values: EventFormValues,
  mode: "create" | "edit",
): SchoolEventInput {
  const input: SchoolEventInput = {
    title: values.title,
    slug: values.slug,
    is_all_day: values.is_all_day,
    // The form refuses a blank or unreadable start, so this is always a timestamp here.
    starts_at: eventInputToIso(values.starts_at, values.is_all_day) ?? values.starts_at,
    ends_at: eventInputToIso(values.ends_at, values.is_all_day),
    location: values.location,
    description: toRichTextPayload(toRichText(values.description)),
  };
  if (values.cover_image_file_id) input.cover_image_file_id = values.cover_image_file_id;
  else if (mode === "edit") input.cover_image_file_id = null;
  return input;
}
