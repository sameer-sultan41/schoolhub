import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Badge, BadgeDot, badgeVariants } from "./badge";

/**
 * Mirrors button.test.tsx's guard: every standard Tailwind palette family plus the
 * arbitrary-hex escape hatch, so a literal colour is caught whichever form it takes.
 * theme.css owns every colour in this package; a component may only name a token.
 */
const LITERAL_COLOUR_UTILITY =
  /(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b|(?:bg|text|border)-\[#/;

const VARIANTS = [
  "primary",
  "secondary",
  "outline",
  "success",
  "warning",
  "danger",
  "info",
] as const;

type Variant = (typeof VARIANTS)[number];

/**
 * The token pair each cell of the variant × appearance matrix must resolve to. Written
 * out rather than derived, so a change to the cva has to be restated here deliberately —
 * these strings are the contrast audit's subject (see badge.tsx's header) and the
 * measured ratios are only valid for exactly these tokens at exactly these opacities.
 */
const EXPECTED: Record<Variant, { solid: [string, string]; soft: [string, string] }> = {
  primary: {
    solid: ["bg-primary", "text-primary-foreground"],
    soft: ["bg-primary/12", "text-foreground"],
  },
  // secondary is already a soft token pair, so its two appearances coincide on purpose.
  secondary: {
    solid: ["bg-secondary", "text-secondary-foreground"],
    soft: ["bg-secondary", "text-secondary-foreground"],
  },
  outline: {
    solid: ["bg-transparent", "text-foreground"],
    soft: ["bg-muted", "text-foreground"],
  },
  success: {
    solid: ["bg-success", "text-success-foreground"],
    soft: ["bg-success/12", "text-foreground"],
  },
  // /20, not /12 — amber is the palette's lightest hue and needs the extra tint to
  // separate its chip from the surface at all. See badge.tsx.
  warning: {
    solid: ["bg-warning", "text-warning-foreground"],
    soft: ["bg-warning/20", "text-foreground"],
  },
  danger: {
    solid: ["bg-danger", "text-danger-foreground"],
    soft: ["bg-danger/12", "text-foreground"],
  },
  info: {
    solid: ["bg-info", "text-info-foreground"],
    soft: ["bg-info/12", "text-foreground"],
  },
};

/** Class lists, not the raw string — `bg-success` is a substring of `bg-success/12`. */
const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

describe("Badge", () => {
  for (const variant of VARIANTS) {
    describe(`variant=${variant}`, () => {
      it("renders solid with its own token pair", () => {
        render(<Badge variant={variant}>Enrolled</Badge>);
        const classes = classesOf(screen.getByText("Enrolled"));

        expect(classes).toEqual(expect.arrayContaining(EXPECTED[variant].solid));
        expect(classes.join(" ")).not.toMatch(LITERAL_COLOUR_UTILITY);
      });

      it("renders soft with its tinted token pair", () => {
        render(
          <Badge variant={variant} appearance="soft">
            Enrolled
          </Badge>,
        );
        const classes = classesOf(screen.getByText("Enrolled"));

        expect(classes).toEqual(expect.arrayContaining(EXPECTED[variant].soft));
        expect(classes.join(" ")).not.toMatch(LITERAL_COLOUR_UTILITY);
      });

      it("defaults to the solid appearance", () => {
        const { rerender } = render(<Badge variant={variant}>Enrolled</Badge>);
        const implicit = screen.getByText("Enrolled").className;

        rerender(
          <Badge variant={variant} appearance="solid">
            Enrolled
          </Badge>,
        );

        expect(screen.getByText("Enrolled").className).toBe(implicit);
      });
    });
  }

  it("still defaults to a solid secondary when given nothing at all", () => {
    render(<Badge>Draft</Badge>);
    const classes = classesOf(screen.getByText("Draft"));

    expect(classes).toEqual(expect.arrayContaining(EXPECTED.secondary.solid));
  });

  /**
   * The contrast guard. `bg-success/12 text-success` is the recipe a soft badge obviously
   * wants and the one this palette cannot afford: measured against every surface plane,
   * the status hues reach at most 4.35:1 as text on their own tint in light mode and fall
   * as low as 1.78:1, and no opacity fixes it — the tint moves the background TOWARD the
   * label, so a heavier tint is strictly worse. Soft labels
   * therefore read --sh-color-foreground. If someone "restores" the hue here, this fails.
   */
  it("never paints a soft label in the variant's own hue", () => {
    for (const variant of ["primary", "success", "warning", "danger", "info"] as const) {
      const { unmount } = render(
        <Badge variant={variant} appearance="soft">
          Enrolled
        </Badge>,
      );

      expect(classesOf(screen.getByText("Enrolled"))).not.toContain(`text-${variant}`);
      unmount();
    }
  });

  /**
   * badgeVariants is exported and callable without `cn`, so it must not depend on
   * tailwind-merge to resolve its own output — hence colour living in compoundVariants
   * rather than being emitted by one axis and overridden by the other.
   */
  it("emits exactly one background and one text colour on its own", () => {
    const classes = badgeVariants({ variant: "success", appearance: "soft" }).split(/\s+/);

    expect(classes.filter((c) => c.startsWith("bg-"))).toEqual(["bg-success/12"]);
    expect(classes.filter((c) => c.startsWith("text-") && c !== "text-xs")).toEqual([
      "text-foreground",
    ]);
    expect(classes.filter((c) => c.startsWith("border-"))).toEqual(["border-success/30"]);
  });

  it("lets a caller override the token pair through className", () => {
    render(
      <Badge variant="success" appearance="soft" className="bg-accent text-accent-foreground">
        Covered
      </Badge>,
    );
    const classes = classesOf(screen.getByText("Covered"));

    expect(classes).toContain("bg-accent");
    expect(classes).not.toContain("bg-success/12");
  });

  it("has no detectable accessibility violations in either appearance", async () => {
    const { container } = render(
      <>
        <Badge variant="success">Active</Badge>
        <Badge variant="success" appearance="soft">
          <BadgeDot />
          Active
        </Badge>
      </>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("BadgeDot", () => {
  it("paints currentColor rather than a colour of its own, so it inherits the badge's", () => {
    render(
      <Badge variant="success" appearance="soft">
        <BadgeDot />
        Active
      </Badge>,
    );
    const badge = screen.getByText("Active");
    const dot = badge.firstElementChild as HTMLElement;

    expect(classesOf(badge)).toContain("text-foreground");
    expect(classesOf(dot)).toContain("bg-[currentColor]");
    // Nothing here may set a colour: the moment it does, the dot stops tracking the badge.
    expect(classesOf(dot).filter((c) => c.startsWith("text-"))).toEqual([]);
    expect(dot.className).not.toMatch(LITERAL_COLOUR_UTILITY);
  });

  it("is decorative — the label beside it carries the meaning", () => {
    render(
      <Badge variant="danger" appearance="soft">
        <BadgeDot />
        Overdue
      </Badge>,
    );
    const dot = screen.getByText("Overdue").firstElementChild;

    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toBeEmptyDOMElement();
  });

  it("takes an explicit colour when a caller wants the hue on the dot alone", () => {
    render(
      <Badge variant="success" appearance="soft">
        <BadgeDot className="text-success" />
        Active
      </Badge>,
    );
    const dot = screen.getByText("Active").firstElementChild as HTMLElement;

    expect(classesOf(dot)).toContain("text-success");
    expect(classesOf(dot)).toContain("bg-[currentColor]");
  });

  it("keeps its size when the label is long enough to compress the row", () => {
    render(
      <Badge appearance="soft">
        <BadgeDot />
        Awaiting guardian confirmation
      </Badge>,
    );
    const dot = screen.getByText("Awaiting guardian confirmation").firstElementChild as HTMLElement;

    expect(classesOf(dot)).toEqual(
      expect.arrayContaining(["size-1.5", "shrink-0", "rounded-full"]),
    );
  });
});
