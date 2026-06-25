/**
 * Rotas de autenticação (montadas em /api/auth):
 *
 *   POST /login     e-mail + senha (+ rememberMe) -> cookies de sessão
 *   POST /refresh   rotaciona o refresh token -> novo access token
 *   POST /logout    revoga a sessão e limpa os cookies
 *   GET  /me        usuário autenticado atual
 *   POST /register  cadastro (desligado por padrão; AUTH_ALLOW_REGISTRATION)
 *
 * Defesas: rate limit por IP (anti brute force) + bloqueio por conta (lockout)
 * + verify de senha "fantasma" para tempo constante + mensagens genéricas
 * (sem enumeração de contas) + refresh tokens rotativos com detecção de reuso.
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { loginSchema, registerSchema } from "./schema";
import {
  hashPassword,
  verifyPassword,
  verifyDummy,
  needsRehash,
} from "./password";
import { signAccessToken } from "./tokens";
import {
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  readRefreshToken,
} from "./cookies";
import {
  createSession,
  rotateRefreshToken,
  revokeSessionByToken,
  type SessionMeta,
} from "./sessions";
import { generateRefreshToken } from "./tokens";
import {
  findUserByEmail,
  findUserById,
  createUser,
  recordSuccessfulLogin,
  recordFailedLogin,
  updatePasswordHash,
  isLocked,
  toPublicUser,
  EmailTakenError,
  type UserRow,
} from "./users";
import { requireAuth } from "./middleware";

// Limite estrito para endpoints sensíveis (login/register/refresh): protege
// contra brute force distribuído por IP, em complemento ao lockout por conta.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  },
});

function metaFrom(req: Request): SessionMeta {
  const ua = req.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 255) : null,
    ip: req.ip ?? null,
  };
}

function refreshTtlFor(rememberMe: boolean): number {
  return rememberMe
    ? config.auth.refreshRememberTtlSec
    : config.auth.refreshTtlSec;
}

/** Cria sessão, assina o access token e seta os cookies. Usado por login/register. */
async function issueSession(
  req: Request,
  res: Response,
  user: UserRow,
  rememberMe: boolean,
): Promise<void> {
  const refreshToken = generateRefreshToken();
  const ttlSec = refreshTtlFor(rememberMe);
  const sessionId = await createSession({
    userId: user.id,
    token: refreshToken,
    rememberMe,
    ttlSec,
    meta: metaFrom(req),
  });
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    sid: sessionId,
  });
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken, ttlSec);
}

export function buildAuthRouter(): Router {
  const router = Router();

  // ---- Login ----
  router.post("/login", sensitiveLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados de login inválidos.",
        errors: parsed.error.flatten(),
      });
    }
    const { email, password, rememberMe } = parsed.data;

    try {
      const user = await findUserByEmail(email);

      // Usuário inexistente: gasta o mesmo tempo de um verify real e responde
      // genérico (não revela se o e-mail existe).
      if (!user) {
        await verifyDummy(password);
        return res.status(401).json({ message: "E-mail ou senha incorretos." });
      }

      if (isLocked(user)) {
        return res.status(429).json({
          message:
            "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.",
        });
      }

      const valid = await verifyPassword(user.password_hash, password);
      if (!valid) {
        await recordFailedLogin(user.id);
        return res.status(401).json({ message: "E-mail ou senha incorretos." });
      }

      // Senha correta mas conta desativada: só o dono (que acertou a senha) vê isto.
      if (!user.is_active) {
        return res.status(403).json({ message: "Conta desativada. Procure um administrador." });
      }

      await recordSuccessfulLogin(user.id);

      // "Sobe" o hash se os custos do argon2 aumentaram desde o último login.
      if (needsRehash(user.password_hash)) {
        try {
          await updatePasswordHash(user.id, await hashPassword(password));
        } catch (e) {
          console.error("Falha ao re-hashear senha (login segue normal):", e);
        }
      }

      await issueSession(req, res, user, rememberMe);
      return res.status(200).json({ user: toPublicUser(user) });
    } catch (err) {
      console.error("Falha no login:", err);
      return res.status(500).json({ message: "Não foi possível concluir o login." });
    }
  });

  // ---- Refresh (rotação) ----
  router.post("/refresh", sensitiveLimiter, async (req: Request, res: Response) => {
    const token = readRefreshToken(req);
    if (!token) {
      return res.status(401).json({ message: "Sessão não encontrada." });
    }
    try {
      const result = await rotateRefreshToken(token, metaFrom(req));
      if (!result.ok) {
        clearAuthCookies(res);
        const message =
          result.reason === "reuse"
            ? "Sessão encerrada por segurança. Faça login novamente."
            : "Sessão expirada. Faça login novamente.";
        return res.status(401).json({ message });
      }

      const accessToken = await signAccessToken({
        sub: result.userId,
        role: result.role,
        sid: result.sessionId,
      });
      setAccessCookie(res, accessToken);
      setRefreshCookie(res, result.newToken, result.ttlSec);

      const user = await findUserById(result.userId);
      if (!user) {
        clearAuthCookies(res);
        return res.status(401).json({ message: "Sessão inválida." });
      }
      return res.status(200).json({ user: toPublicUser(user) });
    } catch (err) {
      console.error("Falha no refresh:", err);
      return res.status(500).json({ message: "Não foi possível renovar a sessão." });
    }
  });

  // ---- Logout ----
  router.post("/logout", async (req: Request, res: Response) => {
    const token = readRefreshToken(req);
    try {
      if (token) await revokeSessionByToken(token);
    } catch (err) {
      console.error("Falha ao revogar sessão no logout:", err);
    } finally {
      clearAuthCookies(res);
    }
    return res.status(204).end();
  });

  // ---- Usuário atual ----
  router.get("/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await findUserById(req.user!.id);
      if (!user) {
        clearAuthCookies(res);
        return res.status(401).json({ message: "Sessão inválida." });
      }
      return res.status(200).json({ user: toPublicUser(user) });
    } catch (err) {
      console.error("Falha ao obter usuário atual:", err);
      return res.status(500).json({ message: "Não foi possível carregar o usuário." });
    }
  });

  // ---- Registro (opcional, desligado por padrão) ----
  router.post("/register", sensitiveLimiter, async (req: Request, res: Response) => {
    if (!config.auth.allowRegistration) {
      // Esconde o endpoint quando desligado.
      return res.status(404).json({ message: "Recurso indisponível." });
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados de cadastro inválidos.",
        errors: parsed.error.flatten(),
      });
    }
    const { name, email, password } = parsed.data;
    try {
      const passwordHash = await hashPassword(password);
      const user = await createUser({ name, email, passwordHash, role: "user" });
      await issueSession(req, res, user, false);
      return res.status(201).json({ user: toPublicUser(user) });
    } catch (err) {
      if (err instanceof EmailTakenError) {
        return res.status(409).json({ message: "E-mail já cadastrado." });
      }
      console.error("Falha no cadastro:", err);
      return res.status(500).json({ message: "Não foi possível concluir o cadastro." });
    }
  });

  return router;
}
