import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/app/lib/request-session";

import { PasswordForm } from "./password-form";

async function PasswordGate() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (!session.user.mustChangePassword) redirect("/");
  return <PasswordForm displayName={session.user.displayName} />;
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<main className="auth-loading">Verificando sessão...</main>}>
      <PasswordGate />
    </Suspense>
  );
}
