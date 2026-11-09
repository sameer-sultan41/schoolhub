"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, EmptyState } from "@schoolhub/ui";
import { Lock, UserSearch } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StudentPicker, type PickedStudent } from "@/components/student-picker";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { FeeInvoiceRecord } from "@/services";
import { RecordPaymentDialog } from "@/features/fees/shared/record-payment-dialog";
import { OutstandingInvoicesCard } from "./outstanding-invoices-card";

/**
 * `/fees/counter`: pick a student, see the invoices that still owe money, record a payment. The
 * section is gated on `fees.payment.collect`; the screen also needs the two reads behind it, the
 * student picker's (`students.student.view`) and the invoices' (`fees.invoice.view`), and
 * without either it says so rather than fetch and fail (L59). Record is hidden from anyone
 * without the collect key. The dialog is mounted only while open.
 */
export function CounterHome() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [target, setTarget] = useState<FeeInvoiceRecord | null>(null);

  const canCollect = hasPermission(user, "fees.payment.collect");
  const canReadStudents = hasPermission(user, "students.student.view");
  const canReadInvoices = hasPermission(user, "fees.invoice.view");
  const isReady = canReadStudents && canReadInvoices;

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("counter.title")} description={t("counter.summary")} />
      </Toolbar>
      {!isReady ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Lock}
              title={t("counter.restricted.title")}
              description={t("counter.restricted.description")}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-2">
              <p className="text-sm font-medium">{t("counter.student")}</p>
              <StudentPicker value={student} onChange={setStudent} />
            </CardContent>
          </Card>
          {student ? (
            <OutstandingInvoicesCard
              key={student.id}
              studentId={student.id}
              studentName={student.name}
              onRecord={canCollect ? setTarget : undefined}
            />
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={UserSearch}
                  title={t("counter.pick.title")}
                  description={t("counter.pick.description")}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {target && (
        <RecordPaymentDialog
          open
          invoice={target}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      )}
    </>
  );
}
