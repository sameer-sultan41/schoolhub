"use client";

import { type ReactNode } from "react";
import { FileUp, Pencil, Search, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface DropdownMenu4Props {
  trigger: ReactNode;
  onView?: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
}

/**
 * A generic "..." card-actions menu: View/Edit/Export/Delete. Each action is a no-op
 * until its handler prop is passed — DropdownMenuItem is already a real Radix menuitem,
 * so there is no navigable `href` to wire (and no next/link dependency to add: this
 * package has none).
 */
export function DropdownMenu4({ trigger, onView, onEdit, onExport, onDelete }: DropdownMenu4Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-[150px]" side="bottom" align="end">
        <DropdownMenuItem onClick={onView}>
          <Search />
          <span>View</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExport}>
          <FileUp />
          <span>Export</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete}>
          <Trash2 />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
