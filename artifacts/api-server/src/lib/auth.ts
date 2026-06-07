import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const DEFAULT_SECRET = "homelab-dashboard-secret-change-in-prod";
const JWT_SECRET = process.env["JWT_SECRET"] || DEFAULT_SECRET;

// Warn loudly (or exit) when running in production with the insecure default secret
if (process.env["NODE_ENV"] === "production" && JWT_SECRET === DEFAULT_SECRET) {
  console.error(
    "[FATAL] JWT_SECRET is set to the insecure default value. " +
    "Set a strong, random JWT_SECRET environment variable before running in production.",
  );
  process.exit(1);
}

export interface JwtPayload {
  userId: number;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
