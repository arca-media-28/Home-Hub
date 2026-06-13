import { connectionStmts, healthStmts } from "./db.js";
import { runPing, connectionToValues, isConfigured } from "./ping.js";
import { logger } from "./logger.js";

const DEFAULT_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 5_000;

function resolveInterval(): number {
  const raw = process.env["HEALTH_CHECK_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 5_000) return DEFAULT_INTERVAL_MS;
  return parsed;
}

// Ping every configured connection once and persist the outcome. Unconfigured
// services (no base URL) are skipped and any stale health row is cleared so the
// dashboard never reports a service the user has removed.
export async function runHealthChecks(): Promise<void> {
  const connections = connectionStmts.findAll.all();

  await Promise.all(
    connections.map(async (conn) => {
      const values = connectionToValues(conn);

      if (!isConfigured(values)) {
        healthStmts.delete.run(conn.service);
        return;
      }

      const result = await runPing(conn.service, values);
      healthStmts.upsert.run(conn.service, result.ok ? 1 : 0, result.message);
    }),
  );
}

let timer: ReturnType<typeof setInterval> | null = null;

// Start the recurring background health check. Runs an initial pass shortly
// after boot, then repeats on the configured interval.
export function startHealthChecks(): void {
  if (timer) return;

  const intervalMs = resolveInterval();

  const tick = () => {
    runHealthChecks().catch((err) => {
      logger.error({ err }, "Health check pass failed");
    });
  };

  setTimeout(tick, STARTUP_DELAY_MS);
  timer = setInterval(tick, intervalMs);

  logger.info({ intervalMs }, "Connection health checks scheduled");
}
