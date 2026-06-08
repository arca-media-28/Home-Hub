import type { Tile } from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";

interface AppTileProps {
  tile: Tile;
}

export default function AppTile({ tile }: AppTileProps) {
  const hasImage = Boolean(tile.imageUrl);
  const bg = tile.bgColor || "hsl(240 6% 12%)";

  const imageFitClass = (() => {
    switch (tile.imageFit) {
      case "cover": return "object-cover";
      case "contain": return "object-contain";
      case "center": return "object-none object-center";
      case "top-left": return "object-none object-left-top";
      default: return "object-cover";
    }
  })();

  return (
    <div
      className="w-full h-full overflow-hidden flex flex-col items-center justify-center relative group cursor-pointer select-none"
      style={{ background: hasImage ? undefined : bg }}
      onClick={() => tile.url && window.open(tile.url, "_blank", "noopener,noreferrer")}
    >
      {hasImage && (
        <img
          src={tile.imageUrl!}
          alt={tile.name || "tile"}
          className={`absolute inset-0 w-full h-full ${imageFitClass}`}
          draggable={false}
        />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />

      <div className="relative z-10 flex flex-col items-center gap-1 px-2 text-center">
        {tile.name && (
          <span
            className="font-bold text-sm leading-tight tracking-wide drop-shadow-sm max-w-full truncate"
            style={{ color: hasImage ? "#fff" : "inherit" }}
          >
            {tile.name}
          </span>
        )}
        {tile.url && (
          <span
            className="text-xs opacity-60 truncate max-w-full hidden group-hover:block"
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
