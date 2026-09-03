import {
  HOSTNAME_PATTERN,
  PORT_SUFFIX_PATTERN,
  SHA256_PREFIX_PATTERN,
  TRAILING_DOT_PATTERN,
  TRAILING_SLASH_PATTERN,
} from "./regex";

describe("TRAILING_SLASH_PATTERN", () => {
  it("matches one or more trailing slashes", () => {
    expect("https://api.example.com/".replace(TRAILING_SLASH_PATTERN, "")).toBe(
      "https://api.example.com",
    );
    expect("https://api.example.com///".replace(TRAILING_SLASH_PATTERN, "")).toBe(
      "https://api.example.com",
    );
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    expect("https://api.example.com".replace(TRAILING_SLASH_PATTERN, "")).toBe(
      "https://api.example.com",
    );
  });
});

describe("PORT_SUFFIX_PATTERN", () => {
  it("strips a trailing port", () => {
    expect("cityschool.schoolhub.pk:3001".replace(PORT_SUFFIX_PATTERN, "")).toBe(
      "cityschool.schoolhub.pk",
    );
  });

  it("leaves a host with no port unchanged", () => {
    expect("cityschool.schoolhub.pk".replace(PORT_SUFFIX_PATTERN, "")).toBe(
      "cityschool.schoolhub.pk",
    );
  });
});

describe("TRAILING_DOT_PATTERN", () => {
  it("strips a single trailing dot", () => {
    expect("cityschool.schoolhub.pk.".replace(TRAILING_DOT_PATTERN, "")).toBe(
      "cityschool.schoolhub.pk",
    );
  });
});

describe("HOSTNAME_PATTERN", () => {
  it("accepts a plausible lowercase hostname", () => {
    expect(HOSTNAME_PATTERN.test("cityschool.schoolhub.pk")).toBe(true);
  });

  it("rejects a value containing anything but lowercase letters, digits, dots and hyphens", () => {
    expect(HOSTNAME_PATTERN.test("Evil Host/../etc")).toBe(false);
    expect(HOSTNAME_PATTERN.test("http://cityschool.schoolhub.pk")).toBe(false);
  });
});

describe("SHA256_PREFIX_PATTERN", () => {
  it("strips the sha256= scheme prefix", () => {
    expect("sha256=abc123".replace(SHA256_PREFIX_PATTERN, "")).toBe("abc123");
  });

  it("leaves a value without the prefix unchanged", () => {
    expect("abc123".replace(SHA256_PREFIX_PATTERN, "")).toBe("abc123");
  });
});
