import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { useTheme } from "../theme.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { user, status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as LocationState | null)?.from ?? "/";

  // Já autenticado: vai direto para o destino.
  if (status === "ready" && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!EMAIL_RE.test(email.trim())) {
      setError("Informe um e-mail válido.");
      return;
    }
    if (!password) {
      setError("Informe a senha.");
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password, rememberMe);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível entrar.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <button
        type="button"
        className="theme-toggle login-screen__theme"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
      >
        {theme === "dark" ? "☀︎ Modo claro" : "☾ Modo escuro"}
      </button>

      <form className="panel login-panel" onSubmit={handleSubmit} noValidate>
        <div className="login-panel__brand">
          <img src="/starbridge-logo.png" alt="Starbridge" />
        </div>

        <div>
          <span className="kicker">Acesso restrito</span>
          <h1 className="panel__title">Entrar</h1>
          <p className="panel__subtitle">
            Use suas credenciais para acessar o painel de cotações.
          </p>
        </div>

        <div className="field">
          <label htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            autoComplete="username"
            autoFocus
            aria-invalid={!!error}
          />
        </div>

        <div className="field">
          <label htmlFor="login-password">Senha</label>
          <div className="input-affix">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              aria-invalid={!!error}
            />
            <button
              type="button"
              className="input-affix__btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <span>Lembrar de mim neste dispositivo</span>
        </label>

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn primary large block"
          disabled={submitting}
        >
          {submitting && <span className="spinner" />}
          {submitting ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p className="login-screen__footer">
        Starbridge · Cotação de insumos &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}
