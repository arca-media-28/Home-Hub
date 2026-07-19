---
name: Picture Frame tile
description: Photo slideshow tile — sources, server proxy paths, and blob-auth rendering gotchas
---

# Picture Frame tile

Full-surface slideshow tile (`integration="pictureframe"`, Fun category) with four photo sources: uploads, pasted URLs, Google Photos album, Immich album.

- **Server proxy URLs need blob auth.** Google baseUrls expire (~60 min) and Immich needs its API key server-side, so `/widgets/photos` returns URLs like `/api/widgets/photos/google/media/:id` — the tile fetches them with the bearer token from `localStorage["token"]` into object URLs (module-level cache). Uploads (`/api/uploads/files/...`) and plain URLs render directly in `<img>`.
- **Google media proxy re-resolves.** For each byte request, re-fetch the mediaItem for a fresh baseUrl, then download `${baseUrl}=w2048-h2048`. A 403 anywhere → 502 with a "re-link your Google account" message (Photos scope was added to the shared Google OAuth).
- **Immich** is a normal per-user connection (`immich` service, url+apiKey, `x-api-key` header); albums `/api/albums`, assets `/api/albums/:id`, thumbnails `/api/assets/:id/thumbnail?size=preview`.
- **Sample mode:** unlinked/unconfigured source OR albumId starting `sample-` → `{sample:true, photos:[]}` and the tile plays built-in inline-SVG demo photos with a Demo badge. Configured failure → 502 → tile error state.
- **Frames are padding, not borders:** wrapper div with padding + background (wood/gold gradients, polaroid off-white with tall bottom, custom color+width); photo area is the inner overflow-hidden box.
- **Why:** keeps API keys and expiring URLs out of the browser while letting the tile stay a dumb `<img>` renderer.
- **How to apply:** any new photo source should return proxy paths under `/api/widgets/photos/<source>/...` so the existing blob-fetch seam picks it up unchanged.
