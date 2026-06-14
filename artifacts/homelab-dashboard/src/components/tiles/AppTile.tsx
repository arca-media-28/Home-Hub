import type { Tile } from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { openTileUrl } from "@/lib/utils";
import { resolveImageStyle, resolveTitleStyle } from "./imageStyle";

interface AppTileProps {
  tile: Tile;
}

export default function AppTile({ tile }: AppTileProps) {
  const hasImage = Boolean(tile.imageUrl);
  const bg = tile.bgColor || "hsl(240 6% 12%)";

  const image = resolveImageStyle(tile);
  const title = resolveTitleStyle(tile);

  return (
    <div
      className="w-full h-full overflow-hidden flex flex-col items-center justify-center relative group cursor-pointer select-none"
      style={{ background: bg }}
      onClick={() => openTileUrl(tile.url)}
    >
      {hasImage && (
        <img
          src={tile.imageUrl!}
          alt={tile.name || "tile"}
          className={`absolute inset-0 w-full h-full ${image.className}`}
          style={image.style}
          draggable={false}
        />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />

      <div
        className={`absolute inset-0 z-10 flex flex-col gap-1 p-2 ${title.containerClass}`}
      >
        {tile.name && (
          <span
            className={`font-bold leading-tight tracking-wide drop-shadow-sm max-w-full truncate ${title.sizeClass} ${title.textAlignClass}`}
            style={{ color: tile.titleColor || (hasImage ? "#fff" : "inherit") }}
          >
            {tile.name}
          </span>
        )}
        {tile.url && (
          <span
            className={`text-xs opacity-60 truncate max-w-full hidden group-hover:block ${title.textAlignClass}`}
            style={{ color: hasImage ? "#fff" : "inherit" }}
          >
            <ExternalLink className="inline w-3 h-3 mr-0.5" />
            Open
          </span>
        )}
      </div>
    </div>
  );
}
