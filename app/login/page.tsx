import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/app/lib/request-session";

import { LoginForm } from "./login-form";

async function LoginGate() {
  const session = await getCurrentSession();
  if (session) redirect(session.user.mustChangePassword ? "/trocar-senha" : "/");
  return <LoginForm />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="auth-loading">Verificando sessão...</main>}>
      <LoginGate />
    </Suspense>
  );
}
