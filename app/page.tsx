import { Suspense } from "react";

import DashboardApp from "./dashboard-app";
import { requireApplicationSession } from "./lib/request-session";

async function AuthenticatedDashboard() {
  const session = await requireApplicationSession();
  return <DashboardApp currentUser={session.user} />;
}

export default function Home() {
  return (
    <Suspense fallback={<main className="auth-loading">Carregando ambiente seguro...</main>}>
      <AuthenticatedDashboard />
    </Suspense>
  );
}
