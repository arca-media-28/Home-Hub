import crypto from "node:crypto";
import { httpClient } from "./http.js";

// Subsonic API version we advertise. 1.16.1 is widely supported (Navidrome,
// Airsonic, Gonic, etc.) and old enough that every modern server accepts it.
const SUBSONIC_VERSION = "1.16.1";
// Client identifier sent on every request (Subsonic requires a `c` param).
const SUBSONIC_CLIENT = "homehub";

// Salted-token auth params for a single request. Subsonic's recommended auth is
// token = md5(password + salt) with a fresh random salt, so the plaintext
// password never travels on the wire. These params are reused for both the API
// call and any media URLs (stream/cover art) built from the same response, so a
// single salt covers the whole request.
export interface SubsonicAuth {
  u: string;
  t: string;
  s: string;
  v: string;
  c: string;
}

export function subsonicAuthParams(username: string, password: string): SubsonicAuth {
  const salt = crypto.randomBytes(8).toString("hex");
  const token = crypto.createHash("md5").update(password + salt).digest("hex");
  return { u: username, t: token, s: salt, v: SUBSONIC_VERSION, c: SUBSONIC_CLIENT };
}

// Query string (no leading "?") carrying the auth params, for building
// browser-loadable media URLs (cover art, stream). `f=json` is omitted because
// these endpoints return binary, not JSON.
export function subsonicMediaQuery(auth: SubsonicAuth): string {
  return new URLSearchParams({ ...auth }).toString();
}

// A single song entry as returned by getNowPlaying, getAlbum, and the album
// list endpoints. Only the fields the Audio Player tile needs are modeled.
export interface SubsonicSong {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration?: number; // seconds
  // Only present on getNowPlaying entries: how many minutes ago the server last
  // registered this track as playing. It's the only live-session signal Subsonic
  // exposes (whole minutes, no sub-minute offset), so we estimate the playback
  // position from it.
  minutesAgo?: number;
}

// Issue a Subsonic REST GET and unwrap the `subsonic-response` envelope.
// Subsonic always answers HTTP 200, even for auth/credential failures — the real
// status lives in `subsonic-response.status` ("ok" | "failed") with an
// `error.message`. Throw on a failed status so callers' try/catch surfaces it as
// a configured-failure (502) consistently with the other widget sources.
export async function subsonicGet(
  baseUrl: string,
  view: string,
  auth: SubsonicAuth,
  extraParams: Record<string, string | number> = {},
): Promise<Record<string, unknown>> {
  const r = await httpClient.get(`${baseUrl}/rest/${view}`, {
    params: { ...auth, f: "json", ...extraParams },
  });
  const body = (r.data as { "subsonic-response"?: Record<string, unknown> } | undefined)?.[
    "subsonic-response"
  ];
  if (!body || body["status"] !== "ok") {
    const message =
      (body?.["error"] as { message?: string } | undefined)?.message ||
      "Subsonic request failed";
    throw new Error(message);
  }
  return body;
}
