"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Skeleton,
  useIsMobile,
} from "@schoolhub/ui";

import { downloadFile, formatDate } from "@/lib/helpers";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { DocumentVerificationDecision, StudentDocumentRecord } from "@/services";
import { DOCUMENT_TYPES } from "@/services/modules/students/students-constant";
import { DocumentUploadDialog } from "./document-upload-dialog";

const STATUS_VARIANT: Record<
  StudentDocumentRecord["verification_status"],
  "success" | "warning" | "destructive"
> = {
  pending: "warning",
  verified: "success",
  rejected: "destructive",
};

/** A tenant's document can carry a `document_type` outside the 6 seeded defaults (an
 * older or externally-written row) — render the raw value rather than indexing into the
 * fixed `documents.type.*` i18n map and hitting a missing key. */
function documentTypeLabel(t: ReturnType<typeof useTranslations>, type: string): string {
  return (DOCUMENT_TYPES as readonly string[]).includes(type) ? t(`documents.type.${type}`) : type;
}

// A document's expiry date is never shown to the user as a raw ISO string — `formatDate`
// (`@/lib/helpers`) is the same "January 5, 2026"-style formatter the staff detail sheet
// already uses for its own absolute dates (joining date, date of birth). Round-6 review:
// this task originally defined its own byte-identical `formatExpiry`, which would have
// been a third copy once this phase shipped — `staff-helper.ts`'s own `formatDate` moves
// to `@/lib/helpers` in this same task (see the file list above) specifically so both
// domains share one implementation instead.

export interface StudentDocumentsTabProps {
  studentId: string;
  canCreate: boolean;
  canVerify: boolean;
  canDelete: boolean;
}

export function StudentDocumentsTab({
  studentId,
  canCreate,
  canVerify,
  canDelete,
}: StudentDocumentsTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const queryClient = useQueryClient();
  // AlertDialog (Radix) and Drawer (vaul) are different primitives with no shared
  // "responsive" wrapper (see `exit-staff-dialog.tsx`'s identical comment) — a plain
  // `Dialog` swaps into `Drawer` through `ResponsiveDialog`, but there is no
  // alertdialog-equivalent on the Drawer side, so the delete confirmation below picks
  // the whole tree rather than one component. This tab can render inside
  // `StudentDetailSheet`'s own mobile `Drawer`, so the desktop-only `AlertDialog` it
  // used unconditionally before this fix was never reachable there at all.
  const isMobile = useIsMobile();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: queryKeys.list("students", "documents", { studentId }),
    queryFn: () => Services.students.fetchDocuments(studentId),
  });
  const documents = documentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "documents", { studentId }),
    });
  }

  const verifyMutation = useMutation({
    mutationFn: ({
      documentId,
      decision,
    }: {
      documentId: string;
      decision: DocumentVerificationDecision;
    }) => Services.students.verifyDocument(documentId, decision),
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.verifyFailed")));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => Services.students.deleteDocument(documentId),
    onSuccess: () => {
      invalidate();
      setPendingDeleteId(null);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.deleteFailed")));
    },
  });

  const downloadMutation = useMutation({
    // `Services.students.getDocumentDownloadUrl` (Task 3), keyed on the document's own
    // id — Task 1's new `students.document.view`-gated `:download` action, not the
    // generic `Services.jobs.fetchFileDownloadUrl` that `/staff`'s export still uses.
    // Takes the document's own title alongside its id, purely for the anchor's
    // `download` filename hint below — never sent to the server.
    mutationFn: async ({ documentId }: { documentId: string; title: string }) => ({
      url: await Services.students.getDocumentDownloadUrl(documentId),
    }),
    // `title` is only a same-origin filename hint (see `downloadFile`).
    onSuccess: ({ url }, { title }) => {
      downloadFile(url, title);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.downloadFailed")));
    },
  });

  if (documentsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (documentsQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("documents.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void documentsQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("documents.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setUploadOpen(true);
            }}
          >
            {t("documents.upload")}
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
      ) : (
        <div className="space-y-3">
          {documents.map((documentRecord) => (
            <div key={documentRecord.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{documentRecord.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {documentTypeLabel(t, documentRecord.document_type)}
                    {documentRecord.expires_at
                      ? ` · ${t("documents.expiresOn", { date: formatDate(documentRecord.expires_at, locale) })}`
                      : ""}
                  </p>
                </div>
                <Badge
                  variant={STATUS_VARIANT[documentRecord.verification_status]}
                  appearance="light"
                >
                  {t(`documents.status.${documentRecord.verification_status}`)}
                </Badge>
              </div>
              {/* Row-specific accessible names (WCAG 2.4.6) below — every row otherwise
               * shares the exact same button text, so a screen-reader user can't tell
               * which document "Download"/"Verify"/"Reject"/"Delete" would act on. */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadMutation.isPending}
                  aria-label={`${t("documents.download")} — ${documentRecord.title}`}
                  onClick={() => {
                    downloadMutation.mutate({
                      documentId: documentRecord.id,
                      title: documentRecord.title,
                    });
                  }}
                >
                  {t("documents.download")}
                </Button>
                {canVerify && documentRecord.verification_status === "pending" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      aria-label={`${t("documents.verify")} — ${documentRecord.title}`}
                      onClick={() => {
                        verifyMutation.mutate({
                          documentId: documentRecord.id,
                          decision: "verified",
                        });
                      }}
                    >
                      {t("documents.verify")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      aria-label={`${t("documents.reject")} — ${documentRecord.title}`}
                      onClick={() => {
                        verifyMutation.mutate({
                          documentId: documentRecord.id,
                          decision: "rejected",
                        });
                      }}
                    >
                      {t("documents.reject")}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`${t("documents.delete")} — ${documentRecord.title}`}
                    onClick={() => {
                      setPendingDeleteId(documentRecord.id);
                    }}
                  >
                    {t("documents.delete")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadOpen && (
        <DocumentUploadDialog
          open
          studentId={studentId}
          onOpenChange={(open) => {
            if (!open) setUploadOpen(false);
          }}
          onUploaded={invalidate}
        />
      )}

      {isMobile ? (
        <Drawer
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          // See the `isMobile` comment above: deliberately not swipe-dismissible, same as
          // `exit-staff-dialog.tsx`'s identical confirmation drawer — an accidental swipe
          // must not silently cancel (or worse, feel like it might have confirmed) a
          // destructive action.
          dismissible={false}
        >
          {/* Both this built-in close button and the footer's Cancel bypass Drawer.Close
              (see drawer.tsx's own departure-log comment #8) — vaul otherwise ignores
              every Drawer.Close-driven close whenever dismissible is false. */}
          <DrawerContent closeLabel={tCommon("close")} role="alertdialog">
            <DrawerHeader>
              <DrawerTitle>{t("documents.deleteConfirmTitle")}</DrawerTitle>
              <DrawerDescription>{t("documents.deleteConfirmDescription")}</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter className="flex-row justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  setPendingDeleteId(null);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
                }}
              >
                {/* A real delete-action verb, not the confirmation question repeated as its
                 * own button label — reuses the same `documents.delete` key the row's own
                 * trigger button already uses. */}
                {t("documents.delete")}
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : (
        <AlertDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("documents.deleteConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("documents.deleteConfirmDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
                }}
              >
                {/* A real delete-action verb, not the confirmation question repeated as its
                 * own button label — reuses the same `documents.delete` key the row's own
                 * trigger button already uses. */}
                {t("documents.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
