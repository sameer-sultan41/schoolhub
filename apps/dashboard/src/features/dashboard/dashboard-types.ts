/**
 * Wire types the home screen needs on top of the ones the feature modules already
 * declare — same convention as academics-types.ts / timetable-types.ts: snake_case
 * fields mirroring the DRF serializers, and no import of the generated schema (none of
 * these paths are in packages/api-client/src/schema.d.ts).
 *
 * Everything else the home screen reads is imported from the module that owns it:
 * `TeacherLoadSummaryRow` / `PromotionBatchRecord` from academics-types.ts,
 * `MyTimetable` / `PeriodRecord` / `SubstitutionRecord` from timetable-types.ts, and
 * `ClassOption` / `SectionOption` from students/enrollment-types.ts. A second
 * declaration of a shape another feature already owns is a second thing to keep in
 * step with the serializer.
 */

/**
 * `GET /academic-sessions`, with the field the option type used by the students and
 * academics screens leaves out.
 *
 * `is_current` is on apps.school_organization.serializers.AcademicSessionSerializer and
 * is read-only there (it moves through `:activate` / `:close`, never a PATCH). The home
 * screen needs it because `GET /teacher-subject-allocations/load-summary` requires an
 * `academic_session_id` — the endpoint 422s without one — and a dashboard has no filter
 * bar to pick one from.
 *
 * Deliberately shares the query key `useAcademicSessions()` uses: it is the same GET
 * against the same path, so one cache entry serves both, and the option type simply
 * does not name a field the payload has always carried.
 */
export interface AcademicSessionSummary {
  id: string;
  name: string;
  status: string;
  is_current: boolean;
}

/**
 * The least a record has to have for a panel that only counts it — `/subjects`,
 * `/rooms`, `/houses`, `/campuses` all satisfy it. Counting is the whole job, so
 * naming any other field would be declaring a shape this screen never reads.
 */
export interface CountableRecord {
  id: string;
}
