/**
 * @schoolhub/ui — components shared by ≥ 2 apps (rule of three), plus the theme-token layer.
 *
 * The stylesheet is imported by the apps, not from here:
 *   @import "@schoolhub/ui/styles/theme.css";
 */
export { Alert, AlertDescription, AlertTitle, alertVariants } from "./components/alert";
export type { AlertProps } from "./components/alert";

export { Avatar, AvatarFallback, AvatarImage } from "./components/avatar";

export { Badge, badgeVariants } from "./components/badge";
export type { BadgeProps } from "./components/badge";

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

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "./components/chart";
export type {
  ChartConfig,
  ChartContainerProps,
  ChartLegendContentProps,
  ChartSlot,
  ChartTooltipContentProps,
} from "./components/chart";

export { DataTable } from "./components/data-table";
export type { DataTableColumn, DataTableProps } from "./components/data-table";

export { EmptyState } from "./components/empty-state";
export type { EmptyStateProps } from "./components/empty-state";

export { StatCard } from "./components/stat-card";
export type { StatCardProps } from "./components/stat-card";

export {
  ChartSkeleton,
  DetailSkeleton,
  FormSkeleton,
  GridSkeleton,
  ScreenHeaderSkeleton,
  TableSkeleton,
} from "./components/skeletons";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "./components/form";

export { Input } from "./components/input";
export type { InputProps } from "./components/input";

export { Label } from "./components/label";

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "./components/popover";
export type { PopoverContentProps } from "./components/popover";

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select";

export { Separator } from "./components/separator";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./components/sidebar";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./components/sheet";

export { Skeleton } from "./components/skeleton";

// Toaster is NOT re-exported here — see @schoolhub/ui/toaster. sonner runs a
// CSS-injection side effect at module-evaluation time that survives tree-shaking (confirmed
// via a real `next build`), so re-exporting it from this barrel would ship it to every
// consumer of anything else here, including apps that never render <Toaster>.

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/table";

export { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";

export { Textarea } from "./components/textarea";
export type { TextareaProps } from "./components/textarea";

export { ToggleGroup, ToggleGroupItem } from "./components/toggle-group";
export type { ToggleGroupItemProps, ToggleGroupProps } from "./components/toggle-group";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip";

export { brandingToCssText, brandingToCssVariables, sanitizeCssValue } from "./lib/branding";
export { cn } from "./lib/cn";
