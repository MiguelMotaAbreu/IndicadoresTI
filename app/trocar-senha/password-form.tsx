"use client";

import { useActionState, useState } from "react";
import {
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import { changeTemporaryPassword, type AuthFormState } from "@/app/actions/auth";
import { Brand } from "@/app/components/brand";

export function PasswordForm({ displayName }: { displayName: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const initialState: AuthFormState = { error: null };
  const [state, formAction, pending] = useActionState(
    changeTemporaryPassword,
    initialState,
  );

  return (
    <main className="login-page">
      <div className="login-page__backdrop" aria-hidden="true" />
      <section className="login-panel login-panel--password" aria-labelledby="password-title">
        <div className="login-panel__brand"><Brand dark /></div>
        <div className="login-panel__intro">
          <p className="eyebrow eyebrow--light">Primeiro acesso</p>
          <h1 id="password-title">Crie sua senha definitiva.</h1>
          <p>Olá, {displayName}. Por segurança, substitua a senha temporária antes de acessar os painéis.</p>
        </div>
        <form className="login-form" action={formAction}>
          <label>
            <span>Nova senha</span>
            <span className="field-with-icon">
              <KeyIcon size={18} />
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="field-action"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Ocultar senhas" : "Mostrar senhas"}
              >
                {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </span>
          </label>
          <label>
            <span>Confirme a nova senha</span>
            <span className="field-with-icon">
              <ShieldCheckIcon size={18} />
              <input
                type={showPassword ? "text" : "password"}
                name="passwordConfirmation"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </span>
          </label>
          <p className="password-hint">Use entre 12 e 128 caracteres e não reutilize a senha temporária.</p>
          {state.error && (
            <p className="auth-error" role="alert"><WarningCircleIcon size={16} />{state.error}</p>
          )}
          <button className="login-submit" type="submit" disabled={pending}>
            {pending ? <span className="button-loading"><span className="spinner" /> Salvando senha...</span> : "Salvar e acessar os painéis"}
          </button>
        </form>
        <p className="login-panel__foot"><ShieldCheckIcon size={16} /> A nova senha será armazenada somente como hash seguro</p>
      </section>
    </main>
  );
}
