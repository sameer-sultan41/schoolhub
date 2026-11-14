import { activeOrCurrent } from "../option-helpers";

describe("activeOrCurrent", () => {
  const records = [{ id: "a", is_active: true }, { id: "b", is_active: false }, { id: "c" }];

  it("drops inactive records", () => {
    expect(activeOrCurrent(records, "").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("keeps the inactive record the form already holds", () => {
    expect(activeOrCurrent(records, "b").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
