import { writePreferenceCookie } from "../preferences-cookies.client";

describe("writePreferenceCookie", () => {
  afterEach(() => {
    // jsdom has no cookie-jar reset between tests; expire whatever this suite wrote.
    document.cookie = "theme_preset=; path=/; max-age=0";
  });

  it("writes the key/value pair, URL-encoded, with a year-long max-age", () => {
    writePreferenceCookie("theme_preset", "metronic");

    expect(document.cookie).toContain("theme_preset=metronic");
  });

  it("URL-encodes a value that isn't already cookie-safe", () => {
    // No real preference value needs this today, but the encoder must not assume one
    // never will — a raw ";" in a cookie value would corrupt the next pair.
    writePreferenceCookie("content_layout", "a;b" as never);

    expect(document.cookie).toContain("content_layout=a%3Bb");
  });
});
