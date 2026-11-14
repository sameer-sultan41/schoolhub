"use client";

import type { ReactNode } from "react";
import { Button } from "@schoolhub/ui";
import { Plus } from "lucide-react";

export interface FeesTabHeaderProps {
  /** The create action's label; the button shows only when `onCreate` is given. */
  createLabel: string;
  onCreate?: () => void;
  children?: ReactNode;
}

/** The row above a tab's table: its create button (omitted without the permission), right-aligned. */
export function FeesTabHeader({ createLabel, onCreate, children }: FeesTabHeaderProps) {
  if (!onCreate && !children) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 pb-4">
      {children}
      {onCreate && (
        <Button variant="primary" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {createLabel}
        </Button>
      )}
    </div>
  );
}
