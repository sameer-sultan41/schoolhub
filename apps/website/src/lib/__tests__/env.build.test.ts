const ORIGINAL_UNOPTIMIZED = process.env.WEBSITE_IMAGES_UNOPTIMIZED;
const ORIGINAL_HOSTNAME = process.env.WEBSITE_IMAGE_HOSTNAME;

afterEach(() => {
  // Assigning `undefined` to process.env stores the string "undefined" — delete instead.
  if (ORIGINAL_UNOPTIMIZED === undefined) delete process.env.WEBSITE_IMAGES_UNOPTIMIZED;
  else process.env.WEBSITE_IMAGES_UNOPTIMIZED = ORIGINAL_UNOPTIMIZED;
  if (ORIGINAL_HOSTNAME === undefined) delete process.env.WEBSITE_IMAGE_HOSTNAME;
  else process.env.WEBSITE_IMAGE_HOSTNAME = ORIGINAL_HOSTNAME;
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

  it("allows no image hostname by default", async () => {
    delete process.env.WEBSITE_IMAGE_HOSTNAME;
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGE_HOSTNAME).toEqual([]);
  });

  it("splits a comma list of image hostnames and drops blanks", async () => {
    process.env.WEBSITE_IMAGE_HOSTNAME = " **.schoolhub.example, api.other.example ,";
    const { buildEnv } = await import("../env.build");
    expect(buildEnv.WEBSITE_IMAGE_HOSTNAME).toEqual(["**.schoolhub.example", "api.other.example"]);
  });
});
