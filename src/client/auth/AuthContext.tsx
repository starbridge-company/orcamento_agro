import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  loginRequest,
  logoutRequest,
  onSessionExpired,
  type AuthUser,
} from "./api.ts";

type AuthStatus = "loading" | "ready";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (
    email: string,
    password: string,
    rememberMe: boolean,
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Bootstrap: tenta restaurar a sessão (cookies) e ouve expiração vinda de
  // qualquer chamada de API (refresh falhou) para deslogar a UI.
  useEffect(() => {
    let active = true;
    fetchMe().then((u) => {
      if (!active) return;
      setUser(u);
      setStatus("ready");
    });
    const off = onSessionExpired(() => setUser(null));
    return () => {
      active = false;
      off();
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, rememberMe: boolean) => {
      const u = await loginRequest(email, password, rememberMe);
      setUser(u);
      return u;
    },
    [],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, status, login, logout }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>.");
  return ctx;
}
