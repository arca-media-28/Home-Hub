import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// Known weak defaults shipped in compose files or docs — reject all of them in production
const KNOWN_WEAK_SECRETS = new Set([
  "homelab-dashboard-secret-change-in-prod",
  "change-this-secret-in-production",
  "secret",
  "changeme",
]);

const rawSecret = process.env["JWT_SECRET"];

// In production, JWT_SECRET must be explicitly provided and must not be a known weak value
if (process.env["NODE_ENV"] === "production") {
  if (!rawSecret || rawSecret.trim() === "" || KNOWN_WEAK_SECRETS.has(rawSecret)) {
    console.error(
      "[FATAL] JWT_SECRET is missing or set to a known-insecure default. " +
      "Provide a strong, randomly-generated JWT_SECRET environment variable before running in production.",
    );
    process.exit(1);
  }
}

const JWT_SECRET = rawSecret ?? "homelab-dashboard-dev-only";

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
