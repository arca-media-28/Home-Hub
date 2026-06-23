---
name: Note (post-it) tile
description: How the homelab-dashboard note/post-it tile splits content vs appearance editing
---

The `note` integration is a post-it tile. Unlike other tiles, its *content*
(free-text body + checklist) is edited **in-place on the tile in locked mode**
(not in the edit modal), debounced through the normal tile-update PUT.

**Why:** in edit/layout mode the dashboard drops a `.drag-handle` overlay over
each tile (drag surface), so inline inputs only work in locked mode — which is
exactly the requirement.

**How to apply:**
- Content fields: `noteBody` (string), `noteItems` (array of `{text,done}` →
  `NoteChecklistItem`). Appearance: `noteColor`, `noteFontSize` (sm/md/lg),
  `noteTextColor`.
- All five live in `TileSettings` and MUST be in `pickTileSettings()` allow-list
  in api-server `routes/tiles.ts` or they silently don't persist.
- The edit modal owns appearance ONLY. Its `handleSave` must re-send the
  existing `tile.tileSettings.noteBody`/`noteItems` so saving appearance doesn't
  wipe content (and vice-versa — the in-place save spreads `...tile.tileSettings`
  to keep appearance).
- Grouped under "Organization" category (alongside spacer/divider) in
  `integrationCategories.ts` — the task brief said "Other" but the existing
  layout helpers actually live in "Organization".
- Rendered by `NoteTile.tsx`, dispatched in dashboard `renderTileContent` BEFORE
  the generic IntegrationTile branch (it paints its own surface, no header).
