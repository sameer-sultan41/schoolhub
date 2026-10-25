/**
 * How many date bands the live lane splits session windows into, one per worker.
 *
 * `live-factories.ts` gives each worker its own band (by `TEST_PARALLEL_INDEX`) so two workers
 * never draw overlapping academic-session dates, and in a live run refuses to load in a fifth
 * worker, which would have no band of its own. `playwright.config.ts` defaults the live lane's
 * workers to this number and never gives CI more. Four bands is what fits before year 9999,
 * the API's last valid date.
 */
export const LIVE_WORKER_BANDS = 4;
