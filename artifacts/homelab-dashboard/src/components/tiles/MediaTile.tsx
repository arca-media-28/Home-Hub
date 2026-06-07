import { useGetMediaRecent } from "@workspace/api-client-react";
import { Tv } from "lucide-react";

export default function MediaTile() {
  const { data, isLoading, isError } = useGetMediaRecent({
    query: { refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (isError || !data?.length) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <Tv className="w-5 h-5 opacity-50" />
        <span>Media server unavailable</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Tv className="w-3.5 h-3.5" />
        Recently Added
      </div>
      <div className="flex-1 overflow-hidden space-y-1.5">
        {data.slice(0, 6).map((item) => (
          <div key={item.id} className="flex items-center gap-2 min-w-0">
            {item.thumb ? (
              <img
                src={item.thumb}
                alt={item.title}
                className="w-8 h-8 rounded object-cover flex-shrink-0 bg-muted"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-muted flex-shrink-0 flex items-center justify-center">
                <Tv className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {item.type}{item.year ? ` · ${item.year}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
