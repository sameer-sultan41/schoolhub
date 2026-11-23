"use client";

import { Alert, AlertDescription, Button, Input, Label, Textarea } from "@schoolhub/ui";
import { useEffect, useRef, useState } from "react";
import { HONEYPOT_FIELD, type PublicFormKind, submitPublicForm } from "@/lib/public-api";
import { COPY } from "@/themes/default/copy";

/**
 * Public form submission.
 *
 * Posts **from the browser** through `@/lib/public-api`, so the renderer's read-only machine
 * token is never involved (website-builder.md §6). The endpoints are tenant-resolved and
 * re-validated server-side, rate-limited per IP and per tenant, and idempotency-protected —
 * none of which we can or should reimplement here.
 *
 * Uncontrolled + native HTML5 validation (required/type=email/maxLength) rather than
 * react-hook-form's Form/FormField set: three fields with no interdependent validation
 * don't need it, and this app has never had a form-state dependency — pulling one in for
 * this would be solving a problem this form doesn't have. Only the styling layer moves
 * onto the shared components (Label/Input/Textarea/Button/Alert).
 */
type Status = "idle" | "submitting" | "sent" | "error";

/** Field limits mirror the API's `CONTACT_*_MAX` constants (website_cms/constants.py). */
const NAME_MAX = 150;
const EMAIL_MAX = 254;
const MESSAGE_MAX = 5000;

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function PublicEnquiryForm({
  kind,
  tenantSlug,
  sourcePageId,
}: {
  kind: PublicFormKind;
  tenantSlug: string;
  /** The published page the form sits on, so staff see where the message came from. */
  sourcePageId?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const confirmationRef = useRef<HTMLDivElement>(null);
  // One key per fill: kept while a request got no answer (a retry may replay it), dropped once
  // the API answered, since an edited retry under the same key would be refused as a reuse.
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    // The success branch below unmounts the whole <form>, submit button included — without
    // this, a keyboard/screen-reader user's focus falls back to <body>, dropped to the top
    // of the document right after submitting. tabIndex={-1} on the wrapper (not a native
    // focus target) makes it programmatically focusable without adding it to tab order.
    if (status === "sent") confirmationRef.current?.focus();
  }, [status]);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    const form = new FormData(event.currentTarget);

    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const accepted = await submitPublicForm(
        kind,
        tenantSlug,
        {
          name: textField(form, "name"),
          email: textField(form, "email"),
          message: textField(form, "message"),
          [HONEYPOT_FIELD]: textField(form, HONEYPOT_FIELD),
          ...(sourcePageId ? { source_page_id: sourcePageId } : {}),
        },
        idempotencyKey.current,
      );
      idempotencyKey.current = null;
      setStatus(accepted ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div ref={confirmationRef} tabIndex={-1}>
        <Alert variant="success" role="status">
          <AlertDescription>
            Thank you — we have received your message and will be in touch.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    // onSubmit is async and already catches its own errors internally (setStatus("error")
    // never throws out), so `void` here only satisfies onSubmit's void-returning type —
    // there is nothing left for a caller to await or handle.
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="enquiry-name">Your name</Label>
        <Input id="enquiry-name" name="name" required maxLength={NAME_MAX} autoComplete="name" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="enquiry-email">Email</Label>
        <Input
          id="enquiry-email"
          name="email"
          type="email"
          required
          maxLength={EMAIL_MAX}
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="enquiry-message">Message</Label>
        <Textarea id="enquiry-message" name="message" required rows={5} maxLength={MESSAGE_MAX} />
      </div>

      {/* Honeypot: hidden from sight, the tab order and assistive technology; people leave it empty. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="enquiry-company-website">{COPY.form.honeypotLabel}</label>
        <input
          id="enquiry-company-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          // Password managers would otherwise offer to fill it and trip the trap.
          data-1p-ignore
          data-lpignore="true"
        />
      </div>

      {status === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>
            We could not send your message. Please try again in a moment.
          </AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" isLoading={status === "submitting"} loadingLabel="Sending">
        Send message
      </Button>
    </form>
  );
}
