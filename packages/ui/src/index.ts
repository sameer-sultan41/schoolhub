/**
 * @schoolhub/ui — components shared by ≥ 2 apps (rule of three), plus the theme-token layer.
 *
 * The stylesheet is imported by the apps, not from here:
 *   @import "@schoolhub/ui/styles/theme.css";
 *
 * Every primitive below (alert through tooltip, plus accordion/breadcrumb/calendar/
 * collapsible/hover-card/kbd/progress/radio-group/scroll-area/switch/toggle) is Metronic's
 * own component, copied verbatim — no variant or structural changes, per explicit
 * instruction. This barrel exports exactly what each file itself exports, nothing more,
 * nothing invented. The data-grid, data-table, empty-state, stat-card, skeletons and
 * sidebar files are schoolhub's own and unaffected by that swap. `accordion-menu` is a
 * port-and-adapt, not a verbatim copy: Metronic's own source applies invalid ARIA `menu`
 * roles to persistent nav, nests a Link inside a button in a way that swallows real
 * navigation, and renders a real `<h3>` heading per item — all three are fixed in this
 * repo's version (see the file's own header comment).
 */
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/accordion";

export {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuIndicator,
  AccordionMenuItem,
  AccordionMenuLabel,
  AccordionMenuSeparator,
  AccordionMenuSub,
  AccordionMenuSubContent,
  AccordionMenuSubTrigger,
  type AccordionMenuClassNames,
} from "./components/accordion-menu";

export {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  AlertToolbar,
} from "./components/alert";

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/alert-dialog";

export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
  avatarStatusVariants,
} from "./components/avatar";

export { AvatarGroup } from "./components/avatar-group";
export type { AvatarGroupAvatar, Avatars } from "./components/avatar-group";

export { Badge, BadgeButton, BadgeDot, badgeVariants } from "./components/badge";
export type { BadgeButtonProps, BadgeDotProps, BadgeProps } from "./components/badge";

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./components/breadcrumb";

export { Button, ButtonArrow, buttonVariants } from "./components/button";

export { Calendar } from "./components/calendar";

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
} from "./components/card";

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "./components/chart";
export type { ChartConfig, ChartTooltipContentProps } from "./components/chart";

export { Checkbox } from "./components/checkbox";

export { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./components/collapsible";

export { DataTable } from "./components/data-table";
export { DataTableColumnsMenu } from "./components/data-table-columns-menu";
export type {
  DataTableColumn,
  DataTableColumnVisibility,
  DataTableCursorPagination,
  DataTablePagePagination,
  DataTablePageSize,
  DataTableProps,
  DataTableSort,
} from "./components/data-table";

export { DataGrid, useDataGrid } from "./components/data-grid";
export type {
  DataGridContextValue,
  DataGridLabels,
  DataGridProps,
  DataGridTableLayout,
} from "./components/data-grid";
export {
  createSelectColumn,
  DataGridTable,
  DataGridTableBase,
  DataGridTableBody,
  DataGridTableBodyRow,
  DataGridTableBodyRowCell,
  DataGridTableBodyRowExpanded,
  DataGridTableBodyRowSkeleton,
  DataGridTableBodyRowSkeletonCell,
  DataGridTableEmpty,
  DataGridTableHead,
  DataGridTableHeadRow,
  DataGridTableHeadRowCell,
  DataGridTableHeadRowCellResize,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
  DataGridTableRowSpacer,
} from "./components/data-grid-table";
export { DataGridColumnHeader } from "./components/data-grid-column-header";
export type { DataGridColumnHeaderProps } from "./components/data-grid-column-header";
export { DataGridColumnVisibility } from "./components/data-grid-column-visibility";
export { DataGridPagination } from "./components/data-grid-pagination";
export type { DataGridPaginationProps } from "./components/data-grid-pagination";
export { DataGridTableDnd } from "./components/data-grid-dnd";
export { DataGridRowDragHandle, DataGridTableDndRows } from "./components/data-grid-dnd-rows";
export { DataGridCard } from "./components/data-grid-card";
export type { DataGridCardProps } from "./components/data-grid-card";
export { pinnedSide, tanStackPinValue } from "./lib/pin-side";
export type { PinnedSide } from "./lib/pin-side";

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
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
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";

export { DropdownMenu4 } from "./components/dropdown-menu-4";

export { EmptyState } from "./components/empty-state";
export type { EmptyStateProps } from "./components/empty-state";

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

export { HoverCard, HoverCardContent, HoverCardTrigger } from "./components/hover-card";

export {
  Input,
  InputAddon,
  InputGroup,
  InputWrapper,
  inputAddonVariants,
  inputVariants,
} from "./components/input";

export { Kbd, kbdVariants } from "./components/kbd";

export { Label } from "./components/label";

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "./components/pagination";
export type { PaginationProps } from "./components/pagination";
export { getPageNumbers, PAGE_WINDOW_SIZE } from "./lib/page-numbers";

export { Popover, PopoverContent, PopoverTrigger } from "./components/popover";

export { Progress, ProgressCircle, ProgressRadial } from "./components/progress";

export { RadioGroup, RadioGroupItem } from "./components/radio-group";

export { Rating } from "./components/rating";

export { ScrollArea, ScrollBar } from "./components/scroll-area";

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectIndicator,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select";
export type { SelectTriggerProps } from "./components/select";

export { Separator } from "./components/separator";

export {
  Sidebar,
  SidebarCollapseToggle,
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
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "./components/sheet";

export { Skeleton } from "./components/skeleton";

export {
  ChartSkeleton,
  DetailSkeleton,
  FormSkeleton,
  GridSkeleton,
  ScreenHeaderSkeleton,
  TableSkeleton,
} from "./components/skeletons";

export { StatCard } from "./components/stat-card";
export type { StatCardProps } from "./components/stat-card";

export { Switch, SwitchIndicator, SwitchWrapper } from "./components/switch";

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

export { Textarea, textareaVariants } from "./components/textarea";

export { Toggle, toggleVariants } from "./components/toggle";
export { ToggleGroup, ToggleGroupItem } from "./components/toggle-group";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip";

export { THEME_PRESETS } from "./styles/presets";
export type { ThemePreset } from "./styles/presets";

export { brandingToCssText, brandingToCssVariables, sanitizeCssValue } from "./lib/branding";
export { cn } from "./lib/cn";

export { useIsMobile } from "./hooks/use-mobile";
export { useMenu } from "./hooks/use-menu";
export { useScrollPosition } from "./hooks/use-scroll-position";

export type { MenuConfig, MenuItem } from "./lib/menu-types";
export { toAbsoluteUrl } from "./lib/to-absolute-url";
