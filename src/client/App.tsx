import {
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useTheme } from "./theme.ts";
import { useAuth } from "./auth/AuthContext.tsx";
import { QuoteForm } from "./components/QuoteForm.tsx";
import { QuotesList } from "./components/QuotesList.tsx";
import { QuoteConversations } from "./components/QuoteConversations.tsx";
import { LoginPage } from "./components/LoginPage.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Iniciais do usuário para o avatar do header. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Chrome comum a todas as rotas: header, abas de navegação e rodapé. */
function Layout() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Aba "Cotações" usa mais largura para a tabela respirar.
  const wide = pathname.startsWith("/cotacoes");

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`page ${wide ? "page--wide" : ""}`}>
      <header className="app-header">
        <img
          className="app-header__logo"
          src="/starbridge-logo.png"
          alt="Starbridge"
        />
        <div className="app-header__right">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"
            }
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span className="theme-toggle__text">
              {theme === "dark" ? "Modo claro" : "Modo escuro"}
            </span>
          </button>

          {user && (
            <div className="user-menu">
              <span className="user-menu__avatar" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="user-menu__info">
                <span className="user-menu__name">{user.name}</span>
                <span className="user-menu__role">{user.role}</span>
              </span>
              <button
                type="button"
                className="btn ghost user-menu__logout"
                onClick={handleLogout}
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="tabs" aria-label="Seções">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}
        >
          Nova cotação
        </NavLink>
        <NavLink
          to="/cotacoes"
          className={({ isActive }) => `tab ${isActive ? "tab--active" : ""}`}
        >
          Cotações
        </NavLink>
      </nav>

      <Outlet />

      <footer className="app-footer">
        Starbridge · Cotação de insumos &copy; {new Date().getFullYear()}
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Pública: tela de login. */}
      <Route path="/login" element={<LoginPage />} />

      {/* Tudo abaixo exige sessão válida (ProtectedRoute). */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<QuoteForm />} />
          <Route path="cotacoes" element={<QuotesList />} />
          {/* splat: a mesma rota cobre /cotacoes/:id e /cotacoes/:id/chat/:conversaId,
              sem remontar o componente ao abrir o chat. */}
          <Route path="cotacoes/:id/*" element={<QuoteConversations />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
