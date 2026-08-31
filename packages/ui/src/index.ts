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

export { DataTable } from "./components/data-table";
export type { DataTableColumn, DataTableProps } from "./components/data-table";

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

export { Toaster } from "./components/sonner";

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

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip";

export { brandingToCssText, brandingToCssVariables, sanitizeCssValue } from "./lib/branding";
export { cn } from "./lib/cn";
