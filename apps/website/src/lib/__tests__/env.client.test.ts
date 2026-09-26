const ORIGINAL = process.env.NEXT_PUBLIC_API_ORIGIN;

afterEach(() => {
  // Assigning `undefined` to process.env stores the string "undefined" — delete instead.
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
  else process.env.NEXT_PUBLIC_API_ORIGIN = ORIGINAL;
  jest.resetModules();
});

describe("publicEnv", () => {
  it("defaults the API origin to same-origin when unset", async () => {
    delete process.env.NEXT_PUBLIC_API_ORIGIN;
    const { publicEnv } = await import("../env.client");
    expect(publicEnv.NEXT_PUBLIC_API_ORIGIN).toBe("");
  });

  it("passes a configured API origin through", async () => {
    process.env.NEXT_PUBLIC_API_ORIGIN = "https://api.example.test";
    const { publicEnv } = await import("../env.client");
    expect(publicEnv.NEXT_PUBLIC_API_ORIGIN).toBe("https://api.example.test");
  });
});
