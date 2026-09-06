import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { DetailRouteLoading, GridRouteLoading } from "@/components/route-loading";
import AcademicsLoading from "./academics/loading";
import AllocationsLoading from "./academics/allocations/loading";
import PromotionBatchLoading from "./academics/promotions/[batchId]/loading";
import PromotionsLoading from "./academics/promotions/loading";
import StaffDetailLoading from "./staff/[staffId]/loading";
import StaffEditLoading from "./staff/[staffId]/edit/loading";
import StaffImportLoading from "./staff/import/loading";
import StaffLoading from "./staff/loading";
import StaffNewLoading from "./staff/new/loading";
import StudentDetailLoading from "./students/[studentId]/loading";
import StudentEditLoading from "./students/[studentId]/edit/loading";
import StudentImportLoading from "./students/import/loading";
import StudentsLoading from "./students/loading";
import StudentNewLoading from "./students/new/loading";
import TimetableLoading from "./timetable/loading";
import MyTimetableLoading from "./timetable/my/loading";
import PeriodsLoading from "./timetable/periods/loading";
import RoomsLoading from "./timetable/rooms/loading";
import SubstitutionsLoading from "./timetable/substitutions/loading";

/**
 * What each route's `loading.tsx` still decides for itself, now that the four shapes live
 * in `components/route-loading.tsx` and are tested there.
 *
 * That is one number per screen, or nothing at all — which is why this is one file rather
 * than the nineteen it replaces, each of which re-asserted the shared shape and asserted
 * nothing about the route it sat in. A wrong column count is a page that loads four wide
 * and lands seven wide, so the numbers are worth pinning; a second render of
 * `DetailSkeleton` is not.
 */

/** TableSkeleton's header row, one cell per column. `border-b` also matches `border-border`. */
const TABLE_HEAD_ROW = '[class*="bg-surface-sunken"]';
/** FormSkeleton's field grid, one child per field. */
const FORM_FIELD_GRID = '[class*="sm:grid-cols-2"]';

const TABLE_ROUTES: { route: string; Loading: ComponentType; columns: number }[] = [
  { route: "/academics", Loading: AcademicsLoading, columns: 7 },
  { route: "/academics/allocations", Loading: AllocationsLoading, columns: 7 },
  { route: "/academics/promotions", Loading: PromotionsLoading, columns: 5 },
  { route: "/staff", Loading: StaffLoading, columns: 4 },
  { route: "/students", Loading: StudentsLoading, columns: 4 },
  { route: "/timetable/periods", Loading: PeriodsLoading, columns: 7 },
  { route: "/timetable/rooms", Loading: RoomsLoading, columns: 8 },
  { route: "/timetable/substitutions", Loading: SubstitutionsLoading, columns: 6 },
];

const FORM_ROUTES: { route: string; Loading: ComponentType; fields: number }[] = [
  { route: "/staff/new", Loading: StaffNewLoading, fields: 14 },
  { route: "/staff/[staffId]/edit", Loading: StaffEditLoading, fields: 14 },
  { route: "/staff/import", Loading: StaffImportLoading, fields: 2 },
  { route: "/students/new", Loading: StudentNewLoading, fields: 14 },
  { route: "/students/[studentId]/edit", Loading: StudentEditLoading, fields: 14 },
  { route: "/students/import", Loading: StudentImportLoading, fields: 2 },
];

const SHARED_SHAPE_ROUTES: { route: string; Loading: ComponentType; shape: ComponentType }[] = [
  {
    route: "/academics/promotions/[batchId]",
    Loading: PromotionBatchLoading,
    shape: DetailRouteLoading,
  },
  { route: "/staff/[staffId]", Loading: StaffDetailLoading, shape: DetailRouteLoading },
  { route: "/students/[studentId]", Loading: StudentDetailLoading, shape: DetailRouteLoading },
  { route: "/timetable", Loading: TimetableLoading, shape: GridRouteLoading },
  { route: "/timetable/my", Loading: MyTimetableLoading, shape: GridRouteLoading },
];

describe("route-level loading states", () => {
  it.each(TABLE_ROUTES)("$route loads a table $columns columns wide", ({ Loading, columns }) => {
    const { container } = render(<Loading />);

    expect(container.querySelector(TABLE_HEAD_ROW)?.children).toHaveLength(columns);
  });

  it.each(FORM_ROUTES)("$route loads a form of $fields fields", ({ Loading, fields }) => {
    const { container } = render(<Loading />);

    expect(container.querySelector(FORM_FIELD_GRID)?.children).toHaveLength(fields);
  });

  it.each(SHARED_SHAPE_ROUTES)(
    "$route is the shared shape, not a copy of it",
    ({ Loading, shape }) => {
      // These routes pass no number of their own, so the only claim they make is which
      // shape they are — and identity is that claim. Re-rendering the shape here would
      // only re-test components/route-loading.test.tsx.
      expect(Loading).toBe(shape);
    },
  );
});
