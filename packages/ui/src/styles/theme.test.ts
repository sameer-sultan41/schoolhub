import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The theme layer is CSS, so it is read as text rather than imported — jest maps every
 * `.css` import to a stub (jest.config.mjs), and a stub cannot tell you whether a token
 * exists. Nothing else in the build fails when a component references a `--sh-*` variable
 * that was never declared: the utility silently resolves to nothing and the element
 * renders transparent. This file is that missing check.
 *
 * The colour literals below are the one place in this repo where they are legal — this
 * IS the file that owns them.
 */
const css = readFileSync(join(__dirname, "theme.css"), "utf8");
const branding = readFileSync(join(__dirname, "..", "lib", "branding.ts"), "utf8");

const CHART_SLOTS = [1, 2, 3, 4, 5, 6] as const;

/** Every token a component may reference. Adding one here before declaring it fails. */
const REQUIRED_TOKENS = [
  "--sh-color-surface-raised",
  "--sh-color-surface-sunken",
  "--sh-color-info",
  "--sh-color-info-foreground",
  "--sh-elevation-1",
  "--sh-elevation-2",
  "--sh-elevation-3",
  "--sh-gradient-spotlight",
  ...CHART_SLOTS.map((slot) => `--sh-color-chart-${slot}`),
];

/** The dark half of the file, which must redeclare everything that flips. */
const darkBlock = css.slice(css.indexOf("/* dark-mode token block */"));

describe("theme.css", () => {
  it.each(REQUIRED_TOKENS)("declares %s", (token) => {
    expect(css).toContain(`${token}:`);
  });

  it.each(REQUIRED_TOKENS)("aliases %s into a Tailwind utility", (token) => {
    expect(css).toContain(`var(${token})`);
  });

  it("marks where the dark-mode token block begins", () => {
    // The slice above is meaningless without this marker, and a silent -1 index would
    // make every dark-mode assertion below pass against the whole file.
    expect(css).toContain("/* dark-mode token block */");
  });

  it.each(CHART_SLOTS)("gives chart slot %i a dark-mode step", (slot) => {
    expect(darkBlock).toContain(`--sh-color-chart-${slot}:`);
  });

  it("re-steps primary and the surface planes for the dark ground", () => {
    for (const token of [
      "--sh-color-primary",
      "--sh-color-surface-raised",
      "--sh-color-surface-sunken",
      "--sh-color-info",
    ]) {
      expect(darkBlock).toContain(`${token}:`);
    }
  });

  it("defines the dark variant for both a class and the OS preference", () => {
    // apps/website has no theme toggle and relies on prefers-color-scheme; apps/dashboard
    // writes a class. A variant covering only one of the two leaves the other app
    // rendering light treatments on a dark surface.
    expect(css).toContain("@custom-variant dark");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toMatch(/\.dark/);
  });

  it("declares identical values in both dark-mode arms", () => {
    // The dark tokens are written twice — once under prefers-color-scheme for
    // apps/website (which has no toggle) and once under `.dark` for the dashboard's.
    // A divergence between them is invisible until someone toggles, which is exactly
    // the kind of bug nothing else here would catch.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const read = (pattern: RegExp): Record<string, string> => {
      const body = pattern.exec(withoutComments)?.[1] ?? "";
      const declarations: Record<string, string> = {};
      // Indexed rather than destructured: tsconfig.base sets noUncheckedIndexedAccess,
      // which types every capture group as `string | undefined`.
      for (const match of body.matchAll(/(--sh-[\w-]+)\s*:\s*([^;]+);/g)) {
        const token = match[1];
        const value = match[2];
        if (token && value) declarations[token] = value.split(/\s+/).join(" ").trim();
      }
      return declarations;
    };

    const mediaArm = read(/:root:not\(\.light\)\s*\{([\s\S]*?)\n {2}\}/);
    const classArm = read(/:root\.dark\s*\{([\s\S]*?)\n\}/);

    expect(Object.keys(mediaArm).length).toBeGreaterThan(0);
    expect(classArm).toEqual(mediaArm);
  });

  it("keeps status colours out of the tenant-overridable branding contract", () => {
    // project-status.md: success/warning/danger are product semantics, not branding.
    // A tenant that could repaint "danger" could make a destructive action look safe.
    for (const token of ["--sh-color-success", "--sh-color-warning", "--sh-color-danger"]) {
      expect(branding).not.toContain(token);
    }
  });

  it("keeps the chart ramp out of the tenant-overridable branding contract", () => {
    // The slot order is the colour-blindness safety mechanism (see theme.css's own
    // header). A tenant overriding one slot would break the validated separation.
    for (const slot of CHART_SLOTS) {
      expect(branding).not.toContain(`--sh-color-chart-${slot}`);
    }
  });

  it("never adds the platform tier to the branding contract", () => {
    expect(branding).not.toContain("--sh-platform-");
  });
});
