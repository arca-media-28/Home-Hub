---
name: Audio library navigation (Plex/Subsonic music browser)
description: Non-obvious decisions behind the Audio Player tile's "Find music" search/browse/playlists pop-out
---

The Audio Player tile (Plex + Navidrome/Subsonic sources only) has a "Find music"
pop-out that searches/browses the library and loads a selection as the player queue.

## Durable decisions / gotchas
- **Container selection = play, not just drill-down.** Clicking any container
  (artist/album/playlist) must load a queue and start playback (player.playQueue),
  then close the panel — drilling-in is a *secondary* affordance (a chevron).
  **Why:** the core requirement is "select album/playlist/artist/track → load as queue";
  a primary click that only navigates does not satisfy it.
- **Artists need fan-out:** browse kind=artist returns *albums*, not songs (both Plex and
  Subsonic), so to play an artist you must fetch each album's tracks and concatenate them.
  Do it with bounded concurrency and an album cap, preserving album order.
- **Demo/unconfigured tracks have no streamUrl** → container selection can't play; fall back
  to drilling in rather than calling playQueue with nothing playable.
- **Tile up-next must follow the LIVE player queue, not the backend session queue, when the
  tile owns playback.** After Find Music calls player.playQueue, the backend `/widgets/audioplayer`
  queue is stale/unrelated; derive now-playing + up-next from player.queue/player.index when
  isOurs, and only fall back to the backend queue when another tile/session owns playback.
- **Plex hubs/search dispatches by each item's own `type`** ("artist"/"album"/"track"), not
  by the hub it came from. Plex artist→albums AND album→tracks both hit
  `/library/metadata/{id}/children`; the difference is only what comes back.
- **Subsonic always returns HTTP 200** even on error — check the subsonic-response status, not
  the HTTP status (see subsonic-audio-source memory).

## Conventions reused (not unique to this feature)
- Unconfigured source → demo (sample:true, streamUrl null); configured-but-failing → 502;
  drill-down kind without an id → 400.
- New per-tile settings (audioSearch/audioBrowse/audioPlaylists, default on) only persist if
  added to the pickTileSettings allow-list — see tile-settings-whitelist memory.
