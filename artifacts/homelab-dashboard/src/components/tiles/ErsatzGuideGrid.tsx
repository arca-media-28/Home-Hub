import { useEffect, useRef } from "react";
import type { ErsatzPlayableChannel } from "@workspace/api-client-react";
import { Play } from "lucide-react";

// ---------------------------------------------------------------------------
// ErsatzGuideGrid: a DirecTV/cable-guide style grid for the Video Player
// tile's ErsatzTV channel pop-out. Channels are rows; programme blocks are
// laid out horizontally on a shared time axis (30-minute slots), sized
// proportionally to their duration. A red "now" line runs across all rows,
// the currently airing block per row is highlighted, and the tuned channel
// row is highlighted too. Clicking a channel cell (or its current programme
// block) tunes the player, same as the old list.
// ---------------------------------------------------------------------------

// Pixels per minute of guide time — a 30-minute slot is 30×PX wide.
const PX_PER_MIN = 3.6;
// Fixed (sticky) channel column width in px.
const CHANNEL_COL = 108;
// How much schedule the grid shows: from the previous half-hour boundary.
const WINDOW_MIN = 195; // 3h15m so a full 3h horizon fits past the boundary

function slotLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ErsatzGuideGrid({
  channels,
  currentNumber,
  nowMs,
  onTune,
  onClose,
}: {
  channels: (ErsatzPlayableChannel & { streamUrl: string })[];
  // Channel number of what's currently tuned (null when nothing matches).
  currentNumber: string | null;
  nowMs: number;
  onTune: (number: string) => void;
  onClose: () => void;
}) {
  // Guide window: previous 30-minute boundary → +WINDOW_MIN.
  const windowStart = Math.floor(nowMs / (30 * 60_000)) * (30 * 60_000);
  const windowEnd = windowStart + WINDOW_MIN * 60_000;
  const timelineW = WINDOW_MIN * PX_PER_MIN;
  const nowX = ((nowMs - windowStart) / 60_000) * PX_PER_MIN;

  const slots: number[] = [];
  for (let t = windowStart; t < windowEnd; t += 30 * 60_000) slots.push(t);

  // On open, scroll so the now-line sits near the left edge (a little
  // context behind it) and the tuned row is visible.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tunedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, nowX - 48);
    tunedRef.current?.scrollIntoView({ block: "nearest" });
    // Only on mount — the user drives scrolling afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="absolute inset-x-2 bottom-[60px] top-2 z-10 flex flex-col overflow-hidden rounded-md border border-white/10 bg-black/90 backdrop-blur-sm"
      data-testid="videoplayer-channels"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
          Guide ({channels.length} channels)
        </span>
        <button
          type="button"
          aria-label="Close channels"
          data-testid="videoplayer-channels-close"
          onClick={onClose}
          className="rounded px-1.5 text-[13px] leading-none text-white/60 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        data-testid="videoplayer-guide-grid"
      >
        <div className="relative" style={{ width: CHANNEL_COL + timelineW }}>
          {/* Time-slot header */}
          <div className="sticky top-0 z-30 flex h-6 bg-black/95">
            <div className="sticky left-0 z-10 w-[108px] shrink-0 border-b border-r border-white/10 bg-black/95" />
            <div className="relative flex-1 border-b border-white/10">
              {slots.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 flex h-full items-center border-l border-white/10 pl-1.5 text-[9px] font-medium uppercase tracking-wide text-white/50"
                  style={{
                    left: ((t - windowStart) / 60_000) * PX_PER_MIN,
                    width: 30 * PX_PER_MIN,
                  }}
                >
                  {slotLabel(t)}
                </span>
              ))}
            </div>
          </div>

          {/* Channel rows */}
          {channels.map((channel) => {
            const isCurrent = channel.number === currentNumber;
            const programs = (channel.programs ?? []).filter(
              (p) => Date.parse(p.stop) > windowStart && Date.parse(p.start) < windowEnd,
            );
            return (
              <div
                key={channel.number}
                ref={isCurrent ? tunedRef : undefined}
                className={`flex h-11 border-b border-white/5 ${
                  isCurrent ? "bg-white/[0.07]" : ""
                }`}
                data-testid="videoplayer-guide-row"
                data-current={isCurrent ? "true" : undefined}
              >
                {/* Sticky channel cell — the click-to-tune target. */}
                <button
                  type="button"
                  data-testid="videoplayer-channel-entry"
                  data-current={isCurrent ? "true" : undefined}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => {
                    if (!isCurrent) onTune(channel.number);
                    onClose();
                  }}
                  className={`sticky left-0 z-20 flex w-[108px] shrink-0 items-center gap-1.5 border-r border-white/10 px-2 text-left text-[11px] leading-tight transition-colors ${
                    isCurrent
                      ? "bg-neutral-900 text-white"
                      : "bg-neutral-950 text-white/70 hover:bg-neutral-800 hover:text-white"
                  }`}
                >
                  <span className="w-6 shrink-0 text-right tabular-nums text-white/40">
                    {channel.number}
                  </span>
                  {isCurrent && (
                    <Play className="h-2.5 w-2.5 shrink-0 fill-current" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                </button>

                {/* Timeline: proportional programme blocks. */}
                <div className="relative min-w-0 flex-1">
                  {programs.length === 0 ? (
                    <div
                      className="absolute inset-y-0.5 left-0.5 flex items-center overflow-hidden rounded-sm border border-dashed border-white/10 bg-white/[0.03] px-2"
                      style={{ width: timelineW - 4 }}
                      data-testid="videoplayer-guide-placeholder"
                    >
                      <span className="truncate text-[10px] italic text-white/35">
                        {channel.nowPlaying ?? "No guide data"}
                      </span>
                    </div>
                  ) : (
                    programs.map((p, i) => {
                      const start = Date.parse(p.start);
                      const stop = Date.parse(p.stop);
                      const left = Math.max(
                        0,
                        ((start - windowStart) / 60_000) * PX_PER_MIN,
                      );
                      const right = Math.min(
                        timelineW,
                        ((stop - windowStart) / 60_000) * PX_PER_MIN,
                      );
                      const width = Math.max(right - left - 2, 6);
                      const airing = nowMs >= start && nowMs < stop;
                      const block = (
                        <span className="flex min-w-0 flex-col justify-center overflow-hidden">
                          <span className="truncate text-[10px] leading-tight">
                            {p.title}
                          </span>
                          {width > 72 && (
                            <span className="truncate text-[8px] leading-tight text-white/40">
                              {slotLabel(start)}
                            </span>
                          )}
                        </span>
                      );
                      const baseClass = `absolute inset-y-0.5 flex items-center overflow-hidden rounded-sm border px-1.5 ${
                        airing
                          ? "border-white/30 bg-white/20 text-white"
                          : "border-white/10 bg-white/[0.06] text-white/65"
                      }`;
                      // The airing block doubles as a tune target.
                      return airing ? (
                        <button
                          key={`${p.start}-${i}`}
                          type="button"
                          data-testid="videoplayer-guide-program"
                          data-airing="true"
                          title={p.title}
                          onClick={() => {
                            if (!isCurrent) onTune(channel.number);
                            onClose();
                          }}
                          className={`${baseClass} text-left transition-colors hover:bg-white/30`}
                          style={{ left, width }}
                        >
                          {block}
                        </button>
                      ) : (
                        <span
                          key={`${p.start}-${i}`}
                          data-testid="videoplayer-guide-program"
                          title={p.title}
                          className={baseClass}
                          style={{ left, width }}
                        >
                          {block}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}

          {/* Now line across all rows (below the sticky header). */}
          <div
            className="pointer-events-none absolute bottom-0 top-6 z-10 w-px bg-red-500/80"
            style={{ left: CHANNEL_COL + nowX }}
            data-testid="videoplayer-guide-nowline"
          >
            <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
