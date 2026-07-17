// Live player-count lookups for game servers.
//
// Pterodactyl's client API exposes power state and resource usage but NOT how
// many players are connected — that information only exists inside each game's
// own query protocol (Minecraft server-list ping, Steam A2S, etc.). Gamedig
// speaks those protocols, so we guess which game a server runs from the panel
// metadata (name, startup invocation, docker image) and query the server's
// public allocation directly. Everything here is best-effort and additive: any
// failure or unknown game simply yields null (the tile omits the player count).
import { GameDig } from "gamedig";
import { logger } from "./logger.js";

export interface PlayerCount {
  current: number;
  max: number | null;
}

// Ordered keyword → gamedig type table. First match wins, so more specific
// patterns (cs2) must precede broader ones (counter-strike). The port offset
// covers games whose query port differs from the game port by convention
// (Valheim answers Steam queries on game port + 1).
const GAME_KEYWORDS: Array<{ re: RegExp; type: string; portOffset: number }> = [
  { re: /minecraft|paper|spigot|purpur|fabric|forge|bukkit|bedrock/, type: "minecraft", portOffset: 0 },
  { re: /valheim/, type: "valheim", portOffset: 1 },
  { re: /palworld/, type: "palworld", portOffset: 0 },
  { re: /\brust\b/, type: "rust", portOffset: 0 },
  { re: /\bark\b|survival evolved|survival ascended/, type: "arkse", portOffset: 0 },
  { re: /counter.?strike ?2|\bcs2\b/, type: "counterstrike2", portOffset: 0 },
  { re: /csgo|counter.?strike/, type: "csgo", portOffset: 0 },
  { re: /7 ?days? to die|7d2d/, type: "sdtd", portOffset: 0 },
  { re: /zomboid/, type: "projectzomboid", portOffset: 0 },
  { re: /satisfactory/, type: "satisfactory", portOffset: 0 },
  { re: /factorio/, type: "factorio", portOffset: 0 },
  { re: /garry'?s ?mod|\bgmod\b/, type: "garrysmod", portOffset: 0 },
  { re: /enshrouded/, type: "enshrouded", portOffset: 0 },
  { re: /v ?rising/, type: "vrising", portOffset: 0 },
  { re: /team ?fortress|\btf2\b/, type: "teamfortress2", portOffset: 0 },
  { re: /unturned/, type: "unturned", portOffset: 0 },
];

// Guess the gamedig game type from free-form panel metadata. Returns null when
// nothing matches — the caller then skips the player query entirely.
export function guessGameType(hints: string): { type: string; portOffset: number } | null {
  const h = hints.toLowerCase();
  for (const g of GAME_KEYWORDS) if (g.re.test(h)) return { type: g.type, portOffset: g.portOffset };
  // A java + .jar startup command is almost always a Minecraft-family server
  // even when the server name doesn't say so ("SMP", "Lobby", …).
  if (h.includes("java") && h.includes(".jar")) return { type: "minecraft", portOffset: 0 };
  return null;
}

// Query one game server for its player count. Never throws.
export async function queryGamePlayers(
  type: string,
  host: string,
  port: number,
): Promise<PlayerCount | null> {
  try {
    const state = await GameDig.query({
      type,
      host,
      port,
      socketTimeout: 2000,
      attemptTimeout: 4000,
      maxRetries: 1,
      // Accept legacy gamedig type ids too, in case of renames across versions.
      checkOldIDs: true,
    });
    const current =
      typeof state.numplayers === "number"
        ? state.numplayers
        : Array.isArray(state.players)
          ? state.players.length
          : null;
    if (current == null) return null;
    const max =
      typeof state.maxplayers === "number" && state.maxplayers > 0 ? state.maxplayers : null;
    return { current, max };
  } catch (err) {
    // Expected for servers without a public query port or mistaken game guess.
    logger.debug(
      { type, host, port, reason: err instanceof Error ? err.message : String(err) },
      "Game server player query failed",
    );
    return null;
  }
}
