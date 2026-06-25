import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";

/**
 * Protege rotas: enquanto a sessão é verificada mostra um loader; sem usuário,
 * redireciona para /login guardando a origem (para voltar após o login).
 */
export function ProtectedRoute() {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <span className="spinner spinner--dark" />
        <span>Carregando…</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
