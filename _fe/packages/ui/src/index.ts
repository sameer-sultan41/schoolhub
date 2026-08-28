/**
 * @schoolhub/ui — components shared by ≥ 2 apps (rule of three), plus the theme-token layer.
 *
 * The stylesheet is imported by the apps, not from here:
 *   @import "@schoolhub/ui/styles/theme.css";
 */
export { Button, buttonVariants } from "./components/button";
export type { ButtonProps } from "./components/button";

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/card";
export type { CardHeaderProps, CardProps } from "./components/card";

export { DataTable } from "./components/data-table";
export type { DataTableColumn, DataTableProps } from "./components/data-table";

export { FormField, Input } from "./components/form-field";
export type { FormFieldProps, InputProps } from "./components/form-field";

export { brandingToCssText, brandingToCssVariables, sanitizeCssValue } from "./lib/branding";
export { cn } from "./lib/cn";
