---
name: Visualizer theme-aware defaults
description: How the Audio Visualizer's default colors follow the active theme
---
Unset visualizerPrimary/visualizerBackground mean "follow the theme": lib/themeColors.ts resolves --primary and --background (fallback --card) (space-separated HSL triples) to hex, used AS-IS (no darkening) — user explicitly wants light themes to show their light background on the tile.
**Why:** hardcoded hex defaults looked alien in non-default themes; user later rejected forced-dark clamping: the tile must genuinely mirror the theme background, light or dark.
**How to apply:** never persist a snapshot of theme colors — the tile editor stores "" / null for "default" and Reset clears rather than writing a hex; useVisualizerThemeDefaults() re-resolves via MutationObserver on <html> attrs + <head> (custom themes).
