import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useTheme } from "./theme.ts";
import { QuoteForm } from "./components/QuoteForm.tsx";
import { QuotesList } from "./components/QuotesList.tsx";
import { QuoteConversations } from "./components/QuoteConversations.tsx";

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

/** Chrome comum a todas as rotas: header, abas de navegação e rodapé. */
function Layout() {
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();
  // Aba "Cotações" usa mais largura para a tabela respirar.
  const wide = pathname.startsWith("/cotacoes");

  return (
    <div className={`page ${wide ? "page--wide" : ""}`}>
      <header className="app-header">
        <img
          className="app-header__logo"
          src="/starbridge-logo.png"
          alt="Starbridge"
        />
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"
          }
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          {theme === "dark" ? "Modo claro" : "Modo escuro"}
        </button>
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
      <Route element={<Layout />}>
        <Route index element={<QuoteForm />} />
        <Route path="cotacoes" element={<QuotesList />} />
        {/* splat: a mesma rota cobre /cotacoes/:id e /cotacoes/:id/chat/:conversaId,
            sem remontar o componente ao abrir o chat. */}
        <Route path="cotacoes/:id/*" element={<QuoteConversations />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
