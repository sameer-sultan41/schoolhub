"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { cva, type VariantProps } from "class-variance-authority";

// Define CardContext
type CardContextType = {
  variant: "default" | "accent";
};

const CardContext = React.createContext<CardContextType>({
  variant: "default", // Default value
});

// Hook to use CardContext
const useCardContext = () => {
  return React.useContext(CardContext);
};

// Variants
const cardVariants = cva("flex flex-col items-stretch text-card-foreground rounded-xl", {
  variants: {
    variant: {
      default: "bg-card border border-border shadow-xs black/5",
      accent: "bg-muted shadow-xs p-1",
    },
    // `elevation` and `tone` are not part of Metronic's own Card — kept as additive axes
    // (default to a no-op, so every existing `variant`-only call site is unaffected) for
    // the one real depth/brand-gradient need this app has: the dashboard's hero band.
    elevation: {
      flat: "",
      /** Sits ABOVE the page — a stat tile, a panel that should read as its own object. */
      raised: "shadow-elevation-2",
      /** Floats — a popover, a dragged item, a card that has been picked up. */
      floating: "shadow-elevation-3",
    },
    tone: {
      surface: "",
      /**
       * The one gradient in the system. Allowed ONCE PER SCREEN, on that screen's hero
       * element, and never as decoration — see theme.css's `--sh-gradient-spotlight`.
       */
      spotlight: "border-transparent bg-spotlight text-spotlight-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
    elevation: "flat",
    tone: "surface",
  },
});

const cardHeaderVariants = cva(
  "flex items-center justify-between flex-wrap px-5 min-h-14 gap-2.5",
  {
    variants: {
      variant: {
        default: "border-b border-border",
        accent: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const cardContentVariants = cva("grow p-5", {
  variants: {
    variant: {
      default: "",
      accent: "bg-card rounded-t-xl [&:last-child]:rounded-b-xl",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const cardTableVariants = cva("grid grow", {
  variants: {
    variant: {
      default: "",
      accent: "bg-card rounded-xl",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const cardFooterVariants = cva("flex items-center px-5 min-h-14", {
  variants: {
    variant: {
      default: "border-t border-border",
      accent: "bg-card rounded-b-xl mt-[2px]",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

// Card Component
function Card({
  className,
  variant = "default",
  elevation,
  tone,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return (
    <CardContext.Provider value={{ variant: variant || "default" }}>
      <div
        data-slot="card"
        className={cn(cardVariants({ variant, elevation, tone }), className)}
        {...props}
      />
    </CardContext.Provider>
  );
}

// CardHeader Component
function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useCardContext();
  return (
    <div
      data-slot="card-header"
      className={cn(cardHeaderVariants({ variant }), className)}
      {...props}
    />
  );
}

// CardContent Component
function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useCardContext();
  return (
    <div
      data-slot="card-content"
      className={cn(cardContentVariants({ variant }), className)}
      {...props}
    />
  );
}

// CardTable Component
function CardTable({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useCardContext();
  return (
    <div
      data-slot="card-table"
      className={cn(cardTableVariants({ variant }), className)}
      {...props}
    />
  );
}

// CardFooter Component
function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useCardContext();
  return (
    <div
      data-slot="card-footer"
      className={cn(cardFooterVariants({ variant }), className)}
      {...props}
    />
  );
}

// Other Components
function CardHeading({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-heading" className={cn("space-y-1", className)} {...props} />;
}

function CardToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-toolbar"
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-base leading-none font-semibold tracking-tight", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

// Exports
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardTitle,
  CardToolbar,
};
