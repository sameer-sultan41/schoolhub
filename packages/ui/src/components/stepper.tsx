"use client";

/**
 * Ported from Metronic's `components/ui/stepper.tsx` (packages/ui/AGENTS.md's
 * sourcing rule). The vendor component already uses only logical flex/gap layout
 * (no hardcoded `left`/`right`) and takes every piece of text as children/props
 * rather than defaulting any English string, so neither of this package's two
 * mandatory port adaptations required a code change. Departures, all forced by
 * this repo's stricter lint rules than the vendor template ships with:
 * - `cn` imported from this package's own `../lib/cn`, not `@/lib/utils`.
 * - `StepperTrigger`'s node registration is a state-backed callback ref, not the
 *   vendor's `useRef` + a `useEffect` keyed on `ref.current` — this repo's
 *   `react-hooks/refs` rule rejects reading a ref's `.current` inside a
 *   dependency array (an effect's or a `useMemo`'s) as "accessing it during
 *   render." Storing the node in state makes it a normal, trackable value
 *   instead.
 * - `registerTrigger`'s unregister-on-unmount branch
 *   (`!node && prev.includes(node!)`) is dropped — `no-unnecessary-condition`
 *   confirmed TypeScript itself proves this branch's condition can never be
 *   true (there's no way to know *which* node a `null` ref callback is
 *   unregistering without also tracking the previous node per trigger, which
 *   the vendor code never did), so it never actually unregistered anything;
 *   this doesn't change any working behavior.
 * - A few `if (fn) fn()` guards against `focusNext`/`focusPrev`/`focusFirst`/
 *   `focusLast`/`indicators` removed — all four are non-optional in
 *   `StepperContextValue`, so the guards were always-true no-ops
 *   (`no-unnecessary-condition`).
 * - `StepperTrigger` composes this package's own `Button` instead of a raw
 *   `<button>` — the vendor source hand-rolls one, which violates this
 *   package's own "never drop to a raw native element" rule. `variant="ghost"`
 *   plus a `className` override resets `Button`'s own size-driven box model
 *   (fixed height/padding, a background on hover) back to the vendor's bare,
 *   content-sized trigger, since the trigger's visual shape comes entirely
 *   from `StepperIndicator`'s own circle.
 */

import * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

type StepperOrientation = "horizontal" | "vertical";
type StepState = "active" | "completed" | "inactive" | "loading";
type StepIndicators = {
  active?: React.ReactNode;
  completed?: React.ReactNode;
  inactive?: React.ReactNode;
  loading?: React.ReactNode;
};

interface StepperContextValue {
  activeStep: number;
  setActiveStep: (step: number) => void;
  stepsCount: number;
  orientation: StepperOrientation;
  registerTrigger: (node: HTMLButtonElement | null) => void;
  triggerNodes: HTMLButtonElement[];
  focusNext: (currentIdx: number) => void;
  focusPrev: (currentIdx: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
  indicators: StepIndicators;
}

interface StepItemContextValue {
  step: number;
  state: StepState;
  isDisabled: boolean;
  isLoading: boolean;
}

const StepperContext = createContext<StepperContextValue | undefined>(undefined);
const StepItemContext = createContext<StepItemContextValue | undefined>(undefined);

function useStepper() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error("useStepper must be used within a Stepper");
  return ctx;
}

function useStepItem() {
  const ctx = useContext(StepItemContext);
  if (!ctx) throw new Error("useStepItem must be used within a StepperItem");
  return ctx;
}

interface StepperProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: number;
  value?: number;
  onValueChange?: (value: number) => void;
  orientation?: StepperOrientation;
  indicators?: StepIndicators;
}

function Stepper({
  defaultValue = 1,
  value,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
  indicators = {},
  ...props
}: StepperProps) {
  const [activeStep, setActiveStep] = React.useState(defaultValue);
  const [triggerNodes, setTriggerNodes] = React.useState<HTMLButtonElement[]>([]);

  const registerTrigger = React.useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    setTriggerNodes((prev) => (prev.includes(node) ? prev : [...prev, node]));
  }, []);

  const handleSetActiveStep = React.useCallback(
    (step: number) => {
      if (value === undefined) {
        setActiveStep(step);
      }
      onValueChange?.(step);
    },
    [value, onValueChange],
  );

  const currentStep = value ?? activeStep;

  const focusTrigger = (idx: number) => {
    if (triggerNodes[idx]) triggerNodes[idx].focus();
  };
  const focusNext = (currentIdx: number) => {
    focusTrigger((currentIdx + 1) % triggerNodes.length);
  };
  const focusPrev = (currentIdx: number) => {
    focusTrigger((currentIdx - 1 + triggerNodes.length) % triggerNodes.length);
  };
  const focusFirst = () => {
    focusTrigger(0);
  };
  const focusLast = () => {
    focusTrigger(triggerNodes.length - 1);
  };

  const contextValue = React.useMemo<StepperContextValue>(
    () => ({
      activeStep: currentStep,
      setActiveStep: handleSetActiveStep,
      stepsCount: React.Children.toArray(children).filter(
        (child): child is React.ReactElement =>
          React.isValidElement(child) &&
          (child.type as { displayName?: string }).displayName === "StepperItem",
      ).length,
      orientation,
      registerTrigger,
      focusNext,
      focusPrev,
      focusFirst,
      focusLast,
      triggerNodes,
      indicators,
    }),
    // focusNext/focusPrev/focusFirst/focusLast are plain closures (not
    // `useCallback`) and `indicators` is a caller-supplied object with no
    // stability guarantee — listing them would make this memo recompute every
    // render anyway, defeating it for no benefit. Vendor's own deliberate
    // choice, kept as-is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentStep, handleSetActiveStep, children, orientation, registerTrigger, triggerNodes],
  );

  return (
    <StepperContext.Provider value={contextValue}>
      <div
        role="tablist"
        aria-orientation={orientation}
        data-slot="stepper"
        className={cn("w-full", className)}
        data-orientation={orientation}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  );
}

interface StepperItemProps extends React.HTMLAttributes<HTMLDivElement> {
  step: number;
  completed?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

function StepperItem({
  step,
  completed = false,
  disabled = false,
  loading = false,
  className,
  children,
  ...props
}: StepperItemProps) {
  const { activeStep } = useStepper();

  const state: StepState =
    completed || step < activeStep ? "completed" : activeStep === step ? "active" : "inactive";

  const isLoading = loading && step === activeStep;

  return (
    <StepItemContext.Provider value={{ step, state, isDisabled: disabled, isLoading }}>
      <div
        data-slot="stepper-item"
        className={cn(
          "group/step flex items-center justify-center not-last:flex-1 group-data-[orientation=horizontal]/stepper-nav:flex-row group-data-[orientation=vertical]/stepper-nav:flex-col",
          className,
        )}
        data-state={state}
        {...(isLoading ? { "data-loading": true } : {})}
        {...props}
      >
        {children}
      </div>
    </StepItemContext.Provider>
  );
}

interface StepperTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

function StepperTrigger({
  asChild = false,
  className,
  children,
  tabIndex,
  ...props
}: StepperTriggerProps) {
  const { state, isLoading } = useStepItem();
  const stepperCtx = useStepper();
  const {
    setActiveStep,
    activeStep,
    registerTrigger,
    triggerNodes,
    focusNext,
    focusPrev,
    focusFirst,
    focusLast,
  } = stepperCtx;
  const { step, isDisabled } = useStepItem();
  const isSelected = activeStep === step;
  const id = `stepper-tab-${step}`;
  const panelId = `stepper-panel-${step}`;

  // A state-backed callback ref, not `useRef` + an effect keyed on `.current` (the
  // vendor's original pattern) — reading a ref's `.current` inside a dependency
  // array counts as accessing it during render, which this repo's stricter
  // `react-hooks/refs` rule rejects. Storing the node in state instead makes it a
  // normal, trackable render dependency.
  const [btnNode, setBtnNode] = React.useState<HTMLButtonElement | null>(null);
  const setBtnRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      setBtnNode(node);
      registerTrigger(node);
    },
    [registerTrigger],
  );

  const myIdx = React.useMemo(
    () => triggerNodes.findIndex((n: HTMLButtonElement) => n === btnNode),
    [triggerNodes, btnNode],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        if (myIdx !== -1) focusNext(myIdx);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        if (myIdx !== -1) focusPrev(myIdx);
        break;
      case "Home":
        e.preventDefault();
        focusFirst();
        break;
      case "End":
        e.preventDefault();
        focusLast();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        setActiveStep(step);
        break;
    }
  };

  if (asChild) {
    return (
      <span data-slot="stepper-trigger" data-state={state} className={className}>
        {children}
      </span>
    );
  }

  return (
    <Button
      ref={setBtnRef}
      type="button"
      variant="ghost"
      role="tab"
      id={id}
      aria-selected={isSelected}
      aria-controls={panelId}
      tabIndex={typeof tabIndex === "number" ? tabIndex : isSelected ? 0 : -1}
      data-slot="stepper-trigger"
      data-state={state}
      data-loading={isLoading}
      className={cn(
        // Resets Button's own `size="md"` box model (fixed height/padding, a
        // rounded-md background on hover) back to the vendor's original bare,
        // content-sized trigger — the visual shape here comes entirely from
        // `StepperIndicator`'s own circle, not from the trigger itself.
        "h-auto w-auto justify-start gap-3 rounded-full bg-transparent p-0 hover:bg-transparent focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      onClick={() => {
        setActiveStep(step);
      }}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      {...props}
    >
      {children}
    </Button>
  );
}

function StepperIndicator({ children, className }: React.ComponentProps<"div">) {
  const { state, isLoading } = useStepItem();
  const { indicators } = useStepper();

  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      className={cn(
        "relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border-background bg-accent text-xs text-accent-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground",
        className,
      )}
    >
      <div className="absolute">
        {(isLoading && indicators.loading) ||
          (state === "completed" && indicators.completed) ||
          (state === "active" && indicators.active) ||
          (state === "inactive" && indicators.inactive) ||
          children}
      </div>
    </div>
  );
}

function StepperSeparator({ className }: React.ComponentProps<"div">) {
  const { state } = useStepItem();

  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        "m-0.5 rounded-full bg-muted group-data-[orientation=horizontal]/stepper-nav:h-0.5 group-data-[orientation=horizontal]/stepper-nav:flex-1 group-data-[orientation=vertical]/stepper-nav:h-12 group-data-[orientation=vertical]/stepper-nav:w-0.5",
        className,
      )}
    />
  );
}

function StepperTitle({ children, className }: React.ComponentProps<"h3">) {
  const { state } = useStepItem();

  return (
    <h3
      data-slot="stepper-title"
      data-state={state}
      className={cn("text-sm leading-none font-medium", className)}
    >
      {children}
    </h3>
  );
}

function StepperNav({ children, className }: React.ComponentProps<"nav">) {
  const { activeStep, orientation } = useStepper();

  return (
    <nav
      data-slot="stepper-nav"
      data-state={activeStep}
      data-orientation={orientation}
      className={cn(
        "group/stepper-nav inline-flex data-[orientation=horizontal]:w-full data-[orientation=horizontal]:flex-row data-[orientation=vertical]:flex-col",
        className,
      )}
    >
      {children}
    </nav>
  );
}

function StepperPanel({ children, className }: React.ComponentProps<"div">) {
  const { activeStep } = useStepper();

  return (
    <div data-slot="stepper-panel" data-state={activeStep} className={cn("w-full", className)}>
      {children}
    </div>
  );
}

interface StepperContentProps extends React.ComponentProps<"div"> {
  value: number;
  forceMount?: boolean;
}

function StepperContent({ value, forceMount, children, className }: StepperContentProps) {
  const { activeStep } = useStepper();
  const isActive = value === activeStep;

  if (!forceMount && !isActive) {
    return null;
  }

  return (
    <div
      data-slot="stepper-content"
      data-state={activeStep}
      className={cn("w-full", className, !isActive && forceMount && "hidden")}
      hidden={!isActive && forceMount}
    >
      {children}
    </div>
  );
}

export {
  useStepper,
  useStepItem,
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperSeparator,
  StepperTitle,
  StepperPanel,
  StepperContent,
  StepperNav,
  type StepperProps,
  type StepperItemProps,
  type StepperTriggerProps,
  type StepperContentProps,
};
