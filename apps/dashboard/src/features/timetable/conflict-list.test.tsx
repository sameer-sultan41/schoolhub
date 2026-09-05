import { screen } from "@testing-library/react";
import {
  CellConflicts,
  ConflictList,
  conflictsBySlot,
  hasHardConflicts,
} from "@/features/timetable/conflict-list";
import type { TimetableConflict } from "@/features/timetable/timetable-types";
import { renderWithProviders } from "@/test-utils";

const TEACHER_CLASH: TimetableConflict = {
  type: "teacher_double_booked",
  severity: "hard",
  slot_ids: ["slot-a", "slot-b"],
  message: "raw server message",
};

const OVER_CAPACITY: TimetableConflict = {
  type: "room_over_capacity",
  severity: "soft",
  slot_ids: ["slot-c"],
  message: "This room seats 20; the section has 31 students.",
};

const UNKNOWN_TYPE: TimetableConflict = {
  type: "some_future_detector",
  severity: "soft",
  slot_ids: ["slot-d"],
  message: "A rule this dashboard has never heard of.",
};

describe("conflictsBySlot", () => {
  it("indexes a clash under both of the slots it names", () => {
    const index = conflictsBySlot([TEACHER_CLASH]);

    expect(index.get("slot-a")).toEqual([TEACHER_CLASH]);
    expect(index.get("slot-b")).toEqual([TEACHER_CLASH]);
  });

  it("collects several findings for the same slot", () => {
    const alsoOnA: TimetableConflict = { ...OVER_CAPACITY, slot_ids: ["slot-a"] };
    const index = conflictsBySlot([TEACHER_CLASH, alsoOnA]);

    expect(index.get("slot-a")).toEqual([TEACHER_CLASH, alsoOnA]);
  });

  it("is empty for an empty list", () => {
    expect(conflictsBySlot([]).size).toBe(0);
  });
});

describe("hasHardConflicts", () => {
  it("is true when any finding blocks publish", () => {
    expect(hasHardConflicts([OVER_CAPACITY, TEACHER_CLASH])).toBe(true);
  });

  it("is false for warnings only, and for nothing at all", () => {
    expect(hasHardConflicts([OVER_CAPACITY])).toBe(false);
    expect(hasHardConflicts([])).toBe(false);
  });
});

describe("ConflictList", () => {
  it("translates a known conflict type rather than showing the server's words", () => {
    renderWithProviders(<ConflictList conflicts={[TEACHER_CLASH]} />);

    expect(
      screen.getByText("This teacher is already teaching in this period."),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw server message")).not.toBeInTheDocument();
  });

  it("falls back to the server's message for a type it has never heard of", () => {
    renderWithProviders(<ConflictList conflicts={[UNKNOWN_TYPE]} />);

    expect(screen.getByText("A rule this dashboard has never heard of.")).toBeInTheDocument();
  });

  it("labels severity so a blocking clash is not read as a warning", () => {
    renderWithProviders(<ConflictList conflicts={[TEACHER_CLASH, OVER_CAPACITY]} />);

    expect(screen.getByText("Blocking")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("keeps the server's hard-first order rather than re-sorting", () => {
    renderWithProviders(<ConflictList conflicts={[TEACHER_CLASH, OVER_CAPACITY]} />);

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Blocking");
    expect(items[1]).toHaveTextContent("Warning");
  });

  it("shows the empty message when one is given and there is nothing to report", () => {
    renderWithProviders(<ConflictList conflicts={[]} emptyMessage="No conflicts found." />);

    expect(screen.getByText("No conflicts found.")).toBeInTheDocument();
  });

  it("renders nothing at all when no empty message is given", () => {
    const { container } = renderWithProviders(<ConflictList conflicts={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("CellConflicts", () => {
  it("lists a cell's own findings without the panel's badges", () => {
    renderWithProviders(<CellConflicts conflicts={[TEACHER_CLASH]} />);

    expect(
      screen.getByText("This teacher is already teaching in this period."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Blocking")).not.toBeInTheDocument();
  });

  it("renders nothing for a clean cell", () => {
    const { container } = renderWithProviders(<CellConflicts conflicts={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
