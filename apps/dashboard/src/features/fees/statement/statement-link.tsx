"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";
import { ScrollText } from "lucide-react";

import { studentStatementPath } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";

/** The key the statement page and its endpoint need (`GET /students/{id}/ledger`). */
export const STATEMENT_VIEW_PERMISSION = "fees.invoice.view";

/**
 * "View statement" for one student, shown only to a holder of `fees.invoice.view`, the key the
 * statement needs; the API enforces it regardless.
 */
export function StatementLink({ studentId }: { studentId: string }) {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  if (!hasPermission(user, STATEMENT_VIEW_PERMISSION)) return null;

  return (
    <Button variant="outline" asChild>
      <Link href={studentStatementPath(studentId)}>
        <ScrollText aria-hidden="true" />
        {t("statement.view")}
      </Link>
    </Button>
  );
}
