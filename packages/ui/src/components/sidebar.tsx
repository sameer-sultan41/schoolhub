"use client";

import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { PanelLeftIcon } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";
import { Skeleton } from "./skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/**
 * Ported from shadcn/ui's Sidebar (registry: new-york-v4, matching this repo's Tailwind v4
 * CSS-first setup) rather than hand-rolled, per this repo's convention of using shadcn's own
 * component when it provides one (see AGENTS.md's "Component sourcing" rule).
 *
 * Two deliberate departures from the upstream source, both required by conventions this
 * package already enforces elsewhere:
 *
 * 1. `side` is typed `"start" | "end"`, not shadcn's own `"left" | "right"`. This package's
 *    own Sheet already uses logical directions so a drawer opens from the correct SCREEN
 *    edge in both `en` (LTR) and `ur` (RTL) — theme.css states outright "never use
 *    left/right offsets in components." Adopting shadcn's physical API verbatim would have
 *    made every desktop position/border/rotate class direction-wrong the instant this
 *    mounted under `dir="rtl"`. The desktop positioning classes below use Tailwind's logical
 *    inset utilities (`start-*`/`end-*`) and `ltr:`/`rtl:` variants instead of shadcn's
 *    `left-0`/`right-0`/`group-data-[side=right]`, so no direction-detection is needed at
 *    any call site — `side="start"` always means the leading edge, in either direction.
 *    `SidebarTrigger`'s icon is mirrored the same way (`rtl:-scale-x-100`) rather than
 *    swapping icon components.
 * 2. `Sidebar` requires `mobileTitle`/`mobileDescription`/`mobileCloseLabel`, and
 *    `SidebarTrigger`/`SidebarRail` require `toggleLabel` — shadcn's stock source hardcodes
 *    "Sidebar" / "Displays the mobile sidebar." / "Toggle Sidebar" as plain English
 *    fallbacks. This package has no i18n of its own (same reasoning already applied to
 *    `Dialog.closeLabel`, `Sheet.closeLabel`, `Button.loadingLabel`, `DataTable`'s
 *    `emptyState`/pagination labels): a silent English default here would always ship
 *    untranslated.
 *
 * `SidebarRail` (a decorative, mouse-only resize handle — `tabIndex={-1}`, not part of the
 * keyboard/screen-reader operable surface) keeps shadcn's original cursor-affordance CSS
 * with only its `data-side` selector values renamed to match (1) above; its RTL cursor
 * semantics are unverified since no consumer in this repo renders it yet. `SidebarTrigger`
 * is the control that must always be present for the sidebar to be operable without a mouse.
 */

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarContextValue {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
}

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = useState(false);

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  // useCallback, not a plain function: the keydown listener below is only attached once
  // (its effect depends on toggleSidebar, not on every render) and needs the CURRENT
  // open/setOpenProp on every call, not whatever they were the one time the listener was
  // registered — a plain function here reproduced exactly that bug: after the first
  // press, every subsequent press recomputed the same stale !open and React bailed on
  // setting state to a value it already held.
  const setOpen = useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        setInternalOpen(openState);
      }
    },
    [open, setOpenProp],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((value) => !value);
    } else {
      setOpen((value) => !value);
    }
  }, [isMobile, setOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = useMemo<SidebarContextValue>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, isMobile, openMobile, setOpen, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

export function Sidebar({
  side = "start",
  variant = "sidebar",
  collapsible = "offcanvas",
  mobileTitle,
  mobileDescription,
  mobileCloseLabel,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  side?: "start" | "end";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  /** sr-only title for the mobile Sheet — required, see file header. */
  mobileTitle: string;
  /** sr-only description for the mobile Sheet — required, see file header. */
  mobileDescription: string;
  /** Accessible name for the mobile Sheet's built-in close button — required, see file header. */
  mobileCloseLabel: string;
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === "none") {
    return (
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-mobile="true"
          side={side}
          closeLabel={mobileCloseLabel}
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE } as CSSProperties}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{mobileTitle}</SheetTitle>
            <SheetDescription>{mobileDescription}</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
    >
      {/* Handles the layout gap on desktop. Rotated only for an end-side sidebar — matches
          upstream's own group-data-[side=right]:rotate-180 exactly, just keyed off the
          logical `end` this file uses instead of physical `right`. This has nothing to do
          with reading direction: an end-side sidebar needs the mirrored collapse-width
          animation regardless of whether the document is ltr or rtl. */}
      <div
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=end]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[inset-inline-start,inset-inline-end,width] duration-200 ease-linear md:flex",
          "start-0 group-data-[collapsible=offcanvas]:start-[calc(var(--sidebar-width)*-1)]",
          "group-data-[side=end]:start-auto group-data-[side=end]:end-0 group-data-[side=end]:group-data-[collapsible=offcanvas]:start-auto group-data-[side=end]:group-data-[collapsible=offcanvas]:end-[calc(var(--sidebar-width)*-1)]",
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=end]:border-s group-data-[side=start]:border-e",
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SidebarTrigger({
  toggleLabel,
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button> & { toggleLabel: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-sidebar="trigger"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon className="rtl:-scale-x-100" />
      <span className="sr-only">{toggleLabel}</span>
    </Button>
  );
}

/**
 * Decorative, mouse-only drag-handle affordance — `tabIndex={-1}`, not part of the
 * keyboard/screen-reader operable surface. `SidebarTrigger` is the control that must be
 * present for the sidebar to be operable without a mouse. Not currently rendered by any
 * consumer in this repo; its RTL cursor semantics (which edge feels like "resize toward
 * start" vs "toward end") are unverified.
 */
export function SidebarRail({
  toggleLabel,
  className,
  ...props
}: ComponentProps<"button"> & { toggleLabel: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      data-sidebar="rail"
      aria-label={toggleLabel}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={toggleLabel}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=end]:start-0 group-data-[side=start]:-end-4 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex",
        "in-data-[side=end]:cursor-e-resize in-data-[side=start]:cursor-w-resize",
        "[[data-side=end][data-state=collapsed]_&]:cursor-w-resize [[data-side=start][data-state=collapsed]_&]:cursor-e-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:start-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "[[data-side=start][data-collapsible=offcanvas]_&]:-end-2",
        "[[data-side=end][data-collapsible=offcanvas]_&]:-start-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      data-sidebar="input"
      className={cn("h-8 w-full bg-background shadow-none", className)}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-sidebar="header" className={cn("flex flex-col gap-2 p-2", className)} {...props} />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-sidebar="footer" className={cn("flex flex-col gap-2 p-2", className)} {...props} />
  );
}

export function SidebarSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-sidebar="group-action"
      className={cn(
        "absolute end-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarGroupContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-sidebar="group-content" className={cn("w-full text-sm", className)} {...props} />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li data-sidebar="menu-item" className={cn("group/menu-item relative", className)} {...props} />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-start text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pe-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button";
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  );

  if (!tooltip) return button;

  const tooltipProps = typeof tooltip === "string" ? { children: tooltip } : tooltip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltipProps}
      />
    </Tooltip>
  );
}

export function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean; showOnHover?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-sidebar="menu-action"
      className={cn(
        "absolute end-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground data-[state=open]:opacity-100 md:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuBadge({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute end-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: ComponentProps<"div"> & { showIcon?: boolean }) {
  const [width] = useState(() => `${Math.floor(Math.random() * 40) + 50}%`);

  return (
    <div
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon ? (
        <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />
      ) : null}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={{ "--skeleton-width": width } as CSSProperties}
      />
    </div>
  );
}

export function SidebarMenuSub({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-s border-sidebar-border px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuSubItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  );
}

export function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean; size?: "sm" | "md"; isActive?: boolean }) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      data-size={size}
      data-active={isActive}
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      {...props}
    />
  );
}
