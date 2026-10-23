"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  CheckCircleIcon,
  CopyIcon,
  PlusIcon,
  PowerIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

type UserRole = "administrador" | "analista";

type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
};

type Credentials = {
  email: string;
  temporaryPassword: string;
};

function roleLabel(role: UserRole): string {
  return role === "administrador" ? "Administrador" : "Analista";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function requestUsers() {
      try {
        const response = await fetch("/api/admin/users", { cache: "no-store", signal: controller.signal });
        const payload = await responsePayload(response);
        if (!response.ok || !Array.isArray(payload.users)) {
          throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível carregar os usuários.");
        }
        setUsers(payload.users as ManagedUser[]);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os usuários.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void requestUsers();
    return () => controller.abort();
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setCreateError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          email: form.get("email"),
          role: form.get("role"),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || typeof payload.temporaryPassword !== "string" || !payload.user) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível criar o usuário.");
      }

      const user = payload.user as ManagedUser;
      setUsers((current) => [...current, user].sort((first, second) => {
        if (first.isActive !== second.isActive) return first.isActive ? -1 : 1;
        return first.displayName.localeCompare(second.displayName, "pt-BR");
      }));
      setCreateOpen(false);
      setCredentials({ email: user.email, temporaryPassword: payload.temporaryPassword });
    } catch (createError) {
      setCreateError(createError instanceof Error ? createError.message : "Não foi possível criar o usuário.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleUser(user: ManagedUser) {
    const action = user.isActive ? "desativar" : "reativar";
    if (!window.confirm(`${action === "desativar" ? "Desativar" : "Reativar"} a conta de ${user.displayName}?`)) return;

    setActionUserId(user.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.user) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Não foi possível atualizar a conta.");
      }
      const updated = payload.user as ManagedUser;
      setUsers((current) => current.map((account) => account.id === updated.id ? updated : account));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Não foi possível atualizar a conta.");
    } finally {
      setActionUserId(null);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    await navigator.clipboard.writeText(`Email: ${credentials.email}\nSenha temporária: ${credentials.temporaryPassword}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="admin-users">
      <div className="admin-section-heading">
        <div><h2>Usuários e permissões</h2><p>Contas locais com perfis Administrador e Analista. Desativar preserva a autoria histórica.</p></div>
        <button className="button button--primary" onClick={() => { setCreateError(null); setCreateOpen(true); }}><PlusIcon size={17} />Novo usuário</button>
      </div>

      <div className="admin-users__summary">
        <span><UserCircleIcon size={20} /><strong>{users.filter((user) => user.isActive).length}</strong><small>contas ativas</small></span>
        <span><ShieldCheckIcon size={20} /><strong>{users.filter((user) => user.isActive && user.role === "administrador").length}</strong><small>administradores ativos</small></span>
        <span><WarningCircleIcon size={20} /><strong>{users.filter((user) => user.isActive && user.mustChangePassword).length}</strong><small>primeiros acessos pendentes</small></span>
      </div>

      {error && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{error}</span><button onClick={() => setError(null)} aria-label="Fechar mensagem"><XIcon size={15} /></button></div>}

      <div className="admin-users__table-wrap">
        {loading ? (
          <div className="admin-users__state">Carregando usuários...</div>
        ) : users.length === 0 ? (
          <div className="admin-users__state">Nenhum usuário cadastrado.</div>
        ) : (
          <table className="admin-users__table">
            <thead><tr><th>Usuário</th><th>Perfil</th><th>Acesso</th><th>Estado</th><th>Última alteração</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {users.map((user) => {
                const isCurrent = user.id === currentUserId;
                return (
                  <tr key={user.id} className={!user.isActive ? "is-inactive" : ""}>
                    <td><strong>{user.displayName}</strong><small>{user.email}{isCurrent ? " · sua conta" : ""}</small></td>
                    <td><span className={`user-role user-role--${user.role}`}>{roleLabel(user.role)}</span></td>
                    <td>{user.mustChangePassword ? <span className="user-access user-access--pending">Troca pendente</span> : <span className="user-access">Senha definida</span>}</td>
                    <td><span className={`user-status ${user.isActive ? "user-status--active" : "user-status--inactive"}`}><i />{user.isActive ? "Ativa" : "Desativada"}</span></td>
                    <td>{formatDate(user.updatedAt)}</td>
                    <td><button className="user-toggle" disabled={isCurrent || actionUserId === user.id} onClick={() => void toggleUser(user)} title={isCurrent ? "A conta atual não pode ser desativada" : undefined}><PowerIcon size={14} />{actionUserId === user.id ? "Salvando..." : user.isActive ? "Desativar" : "Reativar"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <div className="modal-layer" onMouseDown={() => !submitting && setCreateOpen(false)}>
          <form className="user-modal" onSubmit={createUser} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-user-title">
            <header><div><p className="eyebrow">Controle de acesso</p><h2 id="new-user-title">Novo usuário</h2><span>A senha temporária será gerada no servidor.</span></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="Fechar" disabled={submitting}><XIcon size={18} /></button></header>
            <div className="user-modal__body">
              <label>Nome completo<input name="displayName" required minLength={2} maxLength={100} autoFocus autoComplete="name" /></label>
              <label>Email<input name="email" required type="email" maxLength={254} autoComplete="email" /></label>
              <label>Perfil<select name="role" defaultValue="analista"><option value="analista">Analista</option><option value="administrador">Administrador</option></select></label>
              {createError && <div className="admin-users__error" role="alert"><WarningCircleIcon size={18} weight="fill" /><span>{createError}</span><button type="button" onClick={() => setCreateError(null)} aria-label="Fechar mensagem"><XIcon size={15} /></button></div>}
              <div className="quality-note"><ShieldCheckIcon size={17} /><span><strong>Princípio do menor privilégio</strong><small>Use Analista por padrão. Administradores podem gerenciar acesso e configurações da plataforma.</small></span></div>
            </div>
            <footer><button type="button" className="button button--ghost" disabled={submitting} onClick={() => setCreateOpen(false)}>Cancelar</button><button className="button button--primary" disabled={submitting}><PlusIcon size={16} />{submitting ? "Criando..." : "Criar usuário"}</button></footer>
          </form>
        </div>
      )}

      {credentials && (
        <div className="modal-layer">
          <section className="credentials-modal" role="dialog" aria-modal="true" aria-labelledby="credentials-title">
            <span className="credentials-modal__icon"><CheckCircleIcon size={30} weight="fill" /></span>
            <p className="eyebrow">Conta criada</p>
            <h2 id="credentials-title">Entregue estas credenciais agora</h2>
            <p>A senha temporária não será exibida novamente. No primeiro acesso, o usuário deverá substituí-la.</p>
            <div className="credentials-box"><span><small>Email</small><strong>{credentials.email}</strong></span><span><small>Senha temporária</small><code>{credentials.temporaryPassword}</code></span></div>
            <div className="credentials-modal__actions"><button className="button button--ghost" onClick={() => void copyCredentials()}>{copied ? <CheckCircleIcon size={16} /> : <CopyIcon size={16} />}{copied ? "Copiado" : "Copiar credenciais"}</button><button className="button button--primary" onClick={() => setCredentials(null)}>Concluído</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
