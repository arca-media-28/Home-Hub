---
name: Plex machineIdentifier resolution
description: How Plex app.plex.tv deep links source the server machineIdentifier and why it must be resilient
---
Plex deep links (`app.plex.tv/desktop/#!/server/<machineId>/details?key=<encoded /library/metadata/<ratingKey>>`)
need the server's `machineIdentifier`. The library-list containers
(`/library/recentlyAdded`, `/library/onDeck`) do NOT include it, so it is fetched
separately and merged in.

**Rule:** resolve machineIdentifier from `/identity` first, then fall back to the
server root MediaContainer (`/`), which also carries the field. Parse BOTH JSON
(`MediaContainer.machineIdentifier`) and raw XML (regex `machineIdentifier="..."`)
because some proxies/older PMS ignore `Accept: application/json` and return XML.

**Why:** the user's real server was returning `url: null` for every Plex item
because `/identity`-only + JSON-only parsing silently failed. Symptom was
non-clickable Plex items while Jellyfin worked.

**How to apply:** keep resolution additive — a failure must log a warning and
return undefined (→ url:null), never turn the media/continue request into a 502.
The Promise.all in the routes only 502s when the library list itself rejects.
