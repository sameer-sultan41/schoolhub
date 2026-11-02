"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@schoolhub/ui";

export interface GroupTableColumn {
  key: string;
  label: string;
}

export interface GroupTableCardProps {
  /** The group's name: a class, a date. */
  title: ReactNode;
  columns: readonly GroupTableColumn[];
  /** Adds an empty, shrink-to-fit header for a trailing row-actions cell. */
  hasActions: boolean;
  /** The group's `TableRow`s. */
  children: ReactNode;
}

/** One group of an exam tab's rows: a card titled by the group, holding a table of its rows. */
export function GroupTableCard({ title, columns, hasActions, children }: GroupTableCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardHeading>
          <CardTitle>{title}</CardTitle>
        </CardHeading>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key}>{column.label}</TableHead>
              ))}
              {hasActions && <TableHead className="w-0" />}
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
