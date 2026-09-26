import { DASHBOARD_DATA_GRID_LABELS as labels } from "../data-grid-labels";

describe("DASHBOARD_DATA_GRID_LABELS", () => {
  it("every column-action label names the column it acts on", () => {
    expect(labels.sortAscending("Name")).toBe("Sort Name ascending");
    expect(labels.sortDescending("Name")).toBe("Sort Name descending");
    expect(labels.unpinColumn("Status")).toBe("Unpin Status");
    expect(labels.resizeColumn("Status")).toBe("Resize Status column");
  });

  it("the drag/move/pin labels are plain, column-agnostic strings", () => {
    expect(labels.pinToStart).toBe("Pin to start");
    expect(labels.pinToEnd).toBe("Pin to end");
    expect(labels.moveToStart).toBe("Move to start");
    expect(labels.moveToEnd).toBe("Move to end");
    expect(labels.dragToReorderColumn).toBe("Drag to reorder column");
    expect(labels.dragToReorderRow).toBe("Drag to reorder row");
  });

  it("the pagination summary reports the real range and total, not a placeholder", () => {
    expect(labels.pageRangeSummary({ from: 11, to: 20, count: 254 })).toBe("11-20 of 254");
    expect(labels.goToPage(3)).toBe("Go to page 3");
  });
});
