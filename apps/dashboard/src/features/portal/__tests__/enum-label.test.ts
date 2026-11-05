import { enumBadge, enumLabel } from "../enum-label";

/** A translator that knows only `messages`, as next-intl's `has` reports. */
function translator(messages: Record<string, string>) {
  const t = (key: string) => messages[key] ?? key;
  t.has = (key: string) => key in messages;
  return t;
}

describe("enumLabel", () => {
  const keys: Record<string, string> = {
    present: "status.present",
    half_day: "status.half_day",
  };

  it("translates a value the map and the messages know", () => {
    expect(enumLabel(translator({ "status.present": "Present" }), keys, "present")).toBe("Present");
  });

  it("humanises a value the map does not know, never showing a message key", () => {
    expect(enumLabel(translator({}), keys, "on_leave")).toBe("On leave");
  });

  it("humanises a mapped value the messages lack", () => {
    expect(enumLabel(translator({ "status.present": "Present" }), keys, "half_day")).toBe(
      "Half day",
    );
  });
});

describe("enumBadge", () => {
  type Variant = "success" | "secondary";
  const variants: Record<string, Variant> = { paid: "success" };

  it("uses the mapped variant, and the fallback for an unknown value", () => {
    expect(enumBadge<string, Variant>(variants, "paid", "secondary")).toBe("success");
    expect(enumBadge<string, Variant>(variants, "refunded", "secondary")).toBe("secondary");
  });
});
