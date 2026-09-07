import { initialsFor } from "@/lib/names";

describe("initialsFor", () => {
  it("takes the first and last initial", () => {
    expect(initialsFor("Ayesha Khan")).toBe("AK");
  });

  it("skips the middle name rather than crowding the disc", () => {
    expect(initialsFor("Muhammad Yusuf Qureshi")).toBe("MQ");
  });

  it("gives a single-word name one letter rather than an empty disc", () => {
    expect(initialsFor("Prince")).toBe("P");
  });

  it("survives an empty or whitespace-only name", () => {
    expect(initialsFor("")).toBe("");
    expect(initialsFor("   ")).toBe("");
  });

  it("collapses runs of whitespace", () => {
    expect(initialsFor("  Bilal   Ahmed  ")).toBe("BA");
  });

  it("uppercases a lowercase name", () => {
    expect(initialsFor("noor fatima")).toBe("NF");
  });
});
