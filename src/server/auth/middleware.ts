/**
 * Middlewares de autorização. `requireAuth` valida o access token (JWT) e
 * popula req.user; `requireRole` checa a role para controle de acesso.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyAccessToken, type AppRole } from "./tokens";
import { readAccessToken } from "./cookies";

export interface AuthUser {
  id: string;
  role: AppRole;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Exige um access token válido. Responde 401 caso contrário. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ message: "Autenticação necessária." });
    return;
  }
  try {
    const claims = await verifyAccessToken(token);
    req.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
    next();
  } catch {
    res.status(401).json({ message: "Sessão inválida ou expirada." });
  }
}

/** Exige que req.user tenha uma das roles informadas (use após requireAuth). */
export function requireRole(...roles: AppRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Autenticação necessária." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Acesso negado." });
      return;
    }
    next();
  };
}
