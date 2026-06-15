import { useEffect, useState } from "react";
import type { WidgetProps } from "./IntegrationTile";

// A live local-time widget. Runs entirely in the browser (no network calls),
// ticking once a second. Format/seconds/date come from the tile's settings and
// the type scales to fit the tile via CSS container query units.
export default function ClockTile({ tileSettings }: WidgetProps) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hour12 = (tileSettings?.clockFormat ?? "24") === "12";
  const showSeconds = tileSettings?.clockShowSeconds ?? false;
  const showDate = tileSettings?.clockShowDate ?? false;

  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
    hour12,
  });
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  // Scale the time text to the tile: width-bound by character count (~0.62em
  // per glyph with tabular figures) and height-bound so it never overflows.
  // `min()` of both keeps it inside the box on either axis at any tile size.
  const timeWidthCqw = 100 / (timeStr.length * 0.62);
  const timeHeightCqh = showDate ? 36 : 48;
  const timeFontSize = `min(${timeWidthCqw.toFixed(1)}cqw, ${timeHeightCqh}cqh)`;

  const dateWidthCqw = 100 / (dateStr.length * 0.62);
  const dateFontSize = `min(${dateWidthCqw.toFixed(1)}cqw, 14cqh)`;

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-[2cqh] px-2 overflow-hidden text-foreground"
      style={{ containerType: "size" }}
    >
      <span
        className="font-bold leading-none tabular-nums tracking-tight whitespace-nowrap"
        style={{ fontSize: timeFontSize }}
      >
        {timeStr}
      </span>
      {showDate && (
        <span
          className="leading-none text-muted-foreground whitespace-nowrap"
          style={{ fontSize: dateFontSize }}
        >
          {dateStr}
        </span>
      )}
    </div>
  );
}
