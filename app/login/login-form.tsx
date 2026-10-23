"use client";

import { useActionState, useState } from "react";
import {
  EnvelopeSimpleIcon,
  EyeIcon,
  EyeSlashIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";

import { login, type AuthFormState } from "@/app/actions/auth";
import { Brand } from "@/app/components/brand";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const initialState: AuthFormState = { error: null };
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="login-page">
      <div className="login-page__backdrop" aria-hidden="true" />
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel__brand"><Brand dark /></div>
        <div className="login-panel__intro">
          <p className="eyebrow eyebrow--light">Indicadores de TI · UPA Zona Leste</p>
          <h1 id="login-title">Decisões melhores começam com dados confiáveis.</h1>
          <p>Acesse os painéis analíticos da equipe de Tecnologia da Informação.</p>
        </div>
        <form className="login-form" action={formAction}>
          <label>
            <span>Email</span>
            <span className="field-with-icon">
              <EnvelopeSimpleIcon size={18} />
              <input
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                maxLength={254}
                required
              />
            </span>
          </label>
          <label>
            <span>Senha</span>
            <span className="field-with-icon">
              <LockKeyIcon size={18} />
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
              <button
                type="button"
                className="field-action"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
              </button>
            </span>
          </label>
          {state.error && (
            <p className="auth-error" role="alert"><WarningCircleIcon size={16} />{state.error}</p>
          )}
          <button className="login-submit" type="submit" disabled={pending}>
            {pending ? <span className="button-loading"><span className="spinner" /> Verificando acesso...</span> : "Entrar na plataforma"}
          </button>
        </form>
        <p className="login-panel__foot"><ShieldCheckIcon size={16} /> Acesso restrito à rede interna · Sessão protegida</p>
      </section>
    </main>
  );
}
