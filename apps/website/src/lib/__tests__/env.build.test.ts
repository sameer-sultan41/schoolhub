const ORIGINAL = process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP;

afterEach(() => {
  // Assigning `undefined` to process.env stores the string "undefined" — delete instead.
  if (ORIGINAL === undefined) delete process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP;
  else process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP = ORIGINAL;
  jest.resetModules();
});

describe("buildEnv", () => {
  it("never allows local image IPs by default", async () => {
    delete process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP;
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGES_ALLOW_LOCAL_IP).toBe(false);
  });

  it("allows them only for the literal true", async () => {
    process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP = "true";
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGES_ALLOW_LOCAL_IP).toBe(true);
  });

  it("refuses any other value rather than guessing", async () => {
    process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP = "yes";
    await expect(import("../env.build")).rejects.toThrow(/Invalid website build configuration/);
  });

  it("reads the API origin from the one public declaration", async () => {
    const { buildEnv } = await import("../env.build");
    const { publicEnv } = await import("../env.client");
    expect(buildEnv.NEXT_PUBLIC_API_ORIGIN).toBe(publicEnv.NEXT_PUBLIC_API_ORIGIN);
  });
});
