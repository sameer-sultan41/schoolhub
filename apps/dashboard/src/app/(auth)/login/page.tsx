import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `LoginForm` reads the `?next=` search param, so it must sit behind a Suspense boundary
 * for this route to prerender.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--sh-radius)] bg-muted" />}>
      <LoginForm />
    </Suspense>
  );
}
