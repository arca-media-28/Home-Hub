import { createContext, useContext } from "react";
import type { Tile } from "@workspace/api-client-react";

// The tiles currently rendered on the active (page, device mode, variant)
// scope. Provided by the dashboard so individual widgets can coordinate with
// sibling tiles — e.g. the ErsatzTV tile acting as a channel remote for a
// Video Player tile on the same page. Defaults to an empty list so widgets
// rendered outside the dashboard (tests, previews) simply find no siblings.
export const PageTilesContext = createContext<Tile[]>([]);

export function usePageTiles(): Tile[] {
  return useContext(PageTilesContext);
}

// The first Video Player tile on the page whose source is ErsatzTV — the
// target a channel-remote click should tune. Null when none is eligible.
export function findErsatzPlayerTile(tiles: Tile[]): Tile | null {
  return (
    tiles.find(
      (t) =>
        t.integration === "videoplayer" &&
        (t.tileSettings as { videoSource?: string } | null | undefined)
          ?.videoSource === "ersatztv",
    ) ?? null
  );
}
