import { useEffect, useRef, useState } from "react";
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
//
// The grid scales to the tile: a ResizeObserver measures the overlay and
// derives (a) a zoom factor from the row height needed for the channel rows
// to fill the available height (clamped so tiny/huge tiles stay sane) —
// row height, channel column width, and every font scale with it — and
// (b) pixels-per-minute from the width so roughly two hours of schedule
// fill the visible timeline instead of leaving dead space on wide tiles.
// ---------------------------------------------------------------------------

// Base (unscaled) metrics — what a small tile renders at zoom 1.
const BASE_PX_PER_MIN = 3.6;
const BASE_CHANNEL_COL = 108;
const BASE_ROW_H = 44;
const BASE_HEADER_H = 24;
// How much schedule the grid shows: from the previous half-hour boundary.
const WINDOW_MIN = 195; // 3h15m so a full 3h horizon fits past the boundary
// How many minutes should fill the visible timeline width on large tiles.
const VISIBLE_MIN = 120;

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
  embedded = false,
  testIdPrefix = "videoplayer",
}: {
  channels: (ErsatzPlayableChannel & { streamUrl?: string | null })[];
  // Channel number of what's currently tuned (null when nothing matches).
  currentNumber: string | null;
  nowMs: number;
  // Optional: when omitted, channel cells render without any click
  // affordance (the guide is read-only — e.g. no eligible player to remote).
  onTune?: (number: string) => void;
  // Optional: when omitted (embedded mode), no close button is shown and
  // tuning doesn't dismiss anything.
  onClose?: () => void;
  // Embedded mode renders the guide as a normal in-flow block that fills its
  // parent (for the ErsatzTV status tile) instead of the absolute overlay
  // used inside the Video Player.
  embedded?: boolean;
  testIdPrefix?: string;
}) {
  const tid = (suffix: string) => `${testIdPrefix}-${suffix}`;
  // Measure the overlay so the grid can scale with the tile.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setBox((prev) =>
          prev && prev.w === r.width && prev.h === r.height
            ? prev
            : { w: r.width, h: r.height },
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom factor from height: rows should fill the body of the overlay
  // (minus the title bar ~30px and the slot header). Clamped to 1..2 so a
  // short lineup on a huge tile doesn't become comically large and small
  // tiles keep the compact baseline. Embedded guides may shrink slightly
  // below the baseline so a few rows fit inside a modest tile section.
  const bodyH = (box?.h ?? 0) - 30 - BASE_HEADER_H;
  const idealRow =
    channels.length > 0 && bodyH > 0 ? bodyH / channels.length : BASE_ROW_H;
  const minZoom = embedded ? 0.8 : 1;
  const zoom = Math.min(2, Math.max(minZoom, idealRow / BASE_ROW_H));
  const rowH = Math.round(BASE_ROW_H * zoom);
  const headerH = Math.round(BASE_HEADER_H * zoom);
  const channelCol = Math.round(BASE_CHANNEL_COL * zoom);
  const font = (px: number) => Math.round(px * zoom);

  // Pixels per minute from width: stretch so ~2h fill the visible timeline
  // on wide tiles; never below the compact baseline (scaled with zoom so
  // blocks keep their proportions when everything else grows).
  const timelineVisibleW = Math.max(0, (box?.w ?? 0) - channelCol);
  const pxPerMin = Math.max(
    BASE_PX_PER_MIN * zoom,
    timelineVisibleW > 0 ? timelineVisibleW / VISIBLE_MIN : 0,
  );

  // Guide window: previous 30-minute boundary → +WINDOW_MIN.
  const windowStart = Math.floor(nowMs / (30 * 60_000)) * (30 * 60_000);
  const windowEnd = windowStart + WINDOW_MIN * 60_000;
  const timelineW = WINDOW_MIN * pxPerMin;
  const nowX = ((nowMs - windowStart) / 60_000) * pxPerMin;

  const slots: number[] = [];
  for (let t = windowStart; t < windowEnd; t += 30 * 60_000) slots.push(t);

  // On open, scroll so the now-line sits near the left edge (a little
  // context behind it) and the tuned row is visible. Re-applied when the
  // measured scale changes (the first ResizeObserver tick re-lays-out the
  // timeline, which would otherwise leave the old scroll offset stale).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tunedRef = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef(false);
  // Programmatic scrollLeft writes fire `scroll` events too — flag them so
  // the onScroll handler doesn't mistake auto-positioning for the user.
  const autoScrollingRef = useRef(false);
  useEffect(() => {
    if (userScrolledRef.current) return;
    autoScrollingRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, nowX - 48);
    tunedRef.current?.scrollIntoView({ block: "nearest" });
    // Release the flag after the browser has dispatched the resulting
    // scroll event(s) — they fire before the next frame paints.
    const raf = requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
    // Only until the user drives scrolling themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerMin]);

  return (
    <div
      ref={overlayRef}
      className={
        embedded
          ? "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-white/10 bg-neutral-950"
          : "absolute inset-x-2 bottom-[60px] top-2 z-10 flex flex-col overflow-hidden rounded-md border border-white/10 bg-black/90 backdrop-blur-sm"
      }
      data-testid={tid("channels")}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
        <span
          className="font-semibold uppercase tracking-wider text-white/70"
          style={{ fontSize: font(11) }}
        >
          Guide ({channels.length} channels)
        </span>
        {onClose && (
          <button
            type="button"
            aria-label="Close channels"
            data-testid={tid("channels-close")}
            onClick={onClose}
            className="rounded px-1.5 leading-none text-white/60 hover:text-white"
            style={{ fontSize: font(13) }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={() => {
          if (!autoScrollingRef.current) userScrolledRef.current = true;
        }}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        data-testid={tid("guide-grid")}
      >
        <div className="relative" style={{ width: channelCol + timelineW }}>
          {/* Time-slot header */}
          <div
            className="sticky top-0 z-30 flex bg-black/95"
            style={{ height: headerH }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-b border-r border-white/10 bg-black/95"
              style={{ width: channelCol }}
            />
            <div className="relative flex-1 border-b border-white/10">
              {slots.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 flex h-full items-center border-l border-white/10 pl-1.5 font-medium uppercase tracking-wide text-white/50"
                  style={{
                    left: ((t - windowStart) / 60_000) * pxPerMin,
                    width: 30 * pxPerMin,
                    fontSize: font(9),
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
                className={`flex border-b border-white/5 ${
                  isCurrent ? "bg-white/[0.07]" : ""
                }`}
                style={{ height: rowH }}
                data-testid={tid("guide-row")}
                data-current={isCurrent ? "true" : undefined}
              >
                {/* Sticky channel cell — the click-to-tune target (a plain
                    cell with no affordance when no tune handler exists). */}
                {onTune ? (
                  <button
                    type="button"
                    data-testid={tid("channel-entry")}
                    data-current={isCurrent ? "true" : undefined}
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => {
                      if (!isCurrent) onTune(channel.number);
                      onClose?.();
                    }}
                    className={`sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-white/10 px-2 text-left leading-tight transition-colors ${
                      isCurrent
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-950 text-white/70 hover:bg-neutral-800 hover:text-white"
                    }`}
                    style={{ width: channelCol, fontSize: font(11) }}
                  >
                    <span
                      className="shrink-0 text-right tabular-nums text-white/40"
                      style={{ width: font(24) }}
                    >
                      {channel.number}
                    </span>
                    {isCurrent && (
                      <Play
                        className="shrink-0 fill-current"
                        style={{ width: font(10), height: font(10) }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  </button>
                ) : (
                  <div
                    data-testid={tid("channel-entry")}
                    data-current={isCurrent ? "true" : undefined}
                    className={`sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-white/10 px-2 text-left leading-tight ${
                      isCurrent
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-950 text-white/70"
                    }`}
                    style={{ width: channelCol, fontSize: font(11) }}
                  >
                    <span
                      className="shrink-0 text-right tabular-nums text-white/40"
                      style={{ width: font(24) }}
                    >
                      {channel.number}
                    </span>
                    {isCurrent && (
                      <Play
                        className="shrink-0 fill-current"
                        style={{ width: font(10), height: font(10) }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  </div>
                )}

                {/* Timeline: proportional programme blocks. */}
                <div className="relative min-w-0 flex-1">
                  {programs.length === 0 ? (
                    <div
                      className="absolute inset-y-0.5 left-0.5 flex items-center overflow-hidden rounded-sm border border-dashed border-white/10 bg-white/[0.03] px-2"
                      style={{ width: timelineW - 4 }}
                      data-testid={tid("guide-placeholder")}
                    >
                      <span
                        className="truncate italic text-white/35"
                        style={{ fontSize: font(10) }}
                      >
                        {channel.nowPlaying ?? "No guide data"}
                      </span>
                    </div>
                  ) : (
                    programs.map((p, i) => {
                      const start = Date.parse(p.start);
                      const stop = Date.parse(p.stop);
                      const left = Math.max(
                        0,
                        ((start - windowStart) / 60_000) * pxPerMin,
                      );
                      const right = Math.min(
                        timelineW,
                        ((stop - windowStart) / 60_000) * pxPerMin,
                      );
                      const width = Math.max(right - left - 2, 6);
                      const airing = nowMs >= start && nowMs < stop;
                      const block = (
                        <span className="flex min-w-0 flex-col justify-center overflow-hidden">
                          <span
                            className="truncate leading-tight"
                            style={{ fontSize: font(10) }}
                          >
                            {p.title}
                          </span>
                          {width > 72 * zoom && (
                            <span
                              className="truncate leading-tight text-white/40"
                              style={{ fontSize: font(8) }}
                            >
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
                      // The airing block doubles as a tune target (when a
                      // tune handler exists).
                      return airing && onTune ? (
                        <button
                          key={`${p.start}-${i}`}
                          type="button"
                          data-testid={tid("guide-program")}
                          data-airing="true"
                          title={p.title}
                          onClick={() => {
                            if (!isCurrent) onTune(channel.number);
                            onClose?.();
                          }}
                          className={`${baseClass} text-left transition-colors hover:bg-white/30`}
                          style={{ left, width }}
                        >
                          {block}
                        </button>
                      ) : (
                        <span
                          key={`${p.start}-${i}`}
                          data-testid={tid("guide-program")}
                          data-airing={airing ? "true" : undefined}
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
            className="pointer-events-none absolute bottom-0 z-10 w-px bg-red-500/80"
            style={{ left: channelCol + nowX, top: headerH }}
            data-testid={tid("guide-nowline")}
          >
            <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
