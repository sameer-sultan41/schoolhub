const ORIGINAL = process.env.WEBSITE_IMAGES_UNOPTIMIZED;

afterEach(() => {
  // Assigning `undefined` to process.env stores the string "undefined" — delete instead.
  if (ORIGINAL === undefined) delete process.env.WEBSITE_IMAGES_UNOPTIMIZED;
  else process.env.WEBSITE_IMAGES_UNOPTIMIZED = ORIGINAL;
  jest.resetModules();
});

describe("buildEnv", () => {
  it("optimises images by default", async () => {
    delete process.env.WEBSITE_IMAGES_UNOPTIMIZED;
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGES_UNOPTIMIZED).toBe(false);
  });

  it("turns the optimiser off only for the literal true", async () => {
    process.env.WEBSITE_IMAGES_UNOPTIMIZED = "true";
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGES_UNOPTIMIZED).toBe(true);
  });

  it("refuses any other value rather than guessing", async () => {
    process.env.WEBSITE_IMAGES_UNOPTIMIZED = "yes";
    await expect(import("../env.build")).rejects.toThrow(/Invalid website build configuration/);
  });

  it("reads the API origin from the one public declaration", async () => {
    const { buildEnv } = await import("../env.build");
    const { publicEnv } = await import("../env.client");
    expect(buildEnv.NEXT_PUBLIC_API_ORIGIN).toBe(publicEnv.NEXT_PUBLIC_API_ORIGIN);
  });
});
