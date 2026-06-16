---
name: Tailscale cloud connection mapping
description: How a cloud-only integration (no LAN base URL) reuses the service_connections url/apiKey fields in the homelab dashboard.
---

Tailscale (and any cloud-only service) has no per-user LAN base URL, but the
whole connection plumbing (`isConfigured`, health checks, `/connections/status`,
`getSavedConnection`) keys off the `url` field. So:

- **`url` field carries the tailnet name**, **`apiKey` carries the API token.**
  In Settings.tsx the two fields are relabelled ("Tailnet name" / "API access
  token") rather than reusing URL_FIELD/API_KEY_FIELD.
- **Why:** storing the tailnet in `url` makes `isConfigured()` return true and
  lets the existing health-check loop + status badge work unchanged.
- **`pingService` must handle the service BEFORE the generic `const base =
  normalizeBaseUrl(v.url)` guard**, because the tailnet name is not a URL.
  Hit the fixed cloud host (`https://api.tailscale.com/...`) directly.

**How to apply:** for any future cloud-only integration, mirror this pattern —
relabel url/apiKey in Settings, early-return in pingService before the base-URL
guard, and the widget route reads `getSavedConnection(service).url` as the
account/tenant identifier.

Tailscale specifics worth remembering:
- The devices list endpoint has **no direct `online` flag**; derive online from
  `lastSeen` within ~5 min (standard heuristic used by Homepage/Homarr).
- Exit node = device's `enabledRoutes` includes `0.0.0.0/0` or `::/0`
  (advertisedRoutes are merely offered; enabled = admin-approved).
- Use `fields=all` to get enabledRoutes + lastSeen on each device.
