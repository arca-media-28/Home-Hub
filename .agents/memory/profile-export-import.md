---
name: Profile export/import
description: Full-profile export/import envelope, replace vs merge semantics, theme bundling on the client
---

- Envelope: format "tachboard-profile" v1 (pages+tiles+per-mode layouts, deviceModes, optional connections). Pages-only files (`homelab-dashboard-pages`) get a dedicated 400 message pointing to the page menu.
- Connections presence must be detected by KEY PRESENCE (`connections != null`), not non-empty length: replace-import with `connections: []` must still wipe + reseed credentials. **Why:** a user with no configured connections exporting with includeConnections=true yields `[]`, and replace should mirror that.
- Merge: page names de-duped via uniquePageName, device modes matched case-insensitively by name, configured connections never clobbered. Whole import runs in one better-sqlite3 transaction.
- Client bundles a `theme` key (active/colors/customThemes from localStorage) into the download; server zod strips it. Import applies via validateCustomTheme + applyThemeToDom; merge keeps existing custom themes.
- **How to apply:** touch the envelope shape → bump/branch on version, keep the pages-only error, and remember api-server workflow is build&&start (restart after route edits).
