import { useState, useEffect, useRef } from "react";

// A curated list of short, calming quotes / fortunes. Kept deliberately concise
// so they always fit the tile at any size.
const FORTUNES = [
  "A calm mind brings inner strength.",
  "Good things come to those who wait.",
  "Today is a perfect day to begin.",
  "Fortune favors the bold.",
  "A journey of a thousand miles begins with one step.",
  "The best time to plant a tree was yesterday.",
  "Small steps still move you forward.",
  "Your patience will be rewarded.",
  "A friendly word costs nothing.",
  "Trust the timing of your life.",
  "Make today count.",
  "What you seek is also seeking you.",
  "The quieter you become, the more you can hear.",
  "Every moment is a fresh beginning.",
  "Luck is what happens when preparation meets opportunity.",
  "A clear conscience is a soft pillow.",
  "Stars can't shine without darkness.",
  "Do one thing every day that scares you.",
  "Happiness is found along the way, not at the end.",
  "Be the reason someone smiles today.",
  "The wise adapt like water.",
  "Great things never came from comfort zones.",
  "An open door awaits you.",
  "Plant kindness and gather love.",
  "The future depends on what you do today.",
] as const;

function randomFortune(prev?: string) {
  let next = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  // Avoid drawing the same fortune twice in a row (the list is comfortably
  // longer than 1, so this always terminates).
  while (next === prev) {
    next = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  }
  return next;
}

// How long the fortune stays before auto-refreshing (ms).
const ROTATE_INTERVAL_MS = 30_000;

// A self-contained random-quote / fortune toy. The fortune refreshes on click
// and automatically on a timer. No backend, no connection — entirely
// client-side. The card and text scale to the tile via CSS container-query
// units (cqw/cqh/cqmin) so they fill any tile dimension.
export default function FortuneTile() {
  const [fortune, setFortune] = useState<string>(() => randomFortune());
  // Bumped on every change so the fade-in animation re-triggers.
  const [tick, setTick] = useState(0);

  function draw() {
    setFortune((prev) => randomFortune(prev));
    setTick((t) => t + 1);
  }

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Auto-rotate on a timer so the tile feels alive even untouched.
  useEffect(() => {
    const id = window.setInterval(() => drawRef.current(), ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Font shrinks for longer fortunes so the text always fits, capped so short
  // ones don't balloon.
  const fontSize = `min(9cqmin, ${(60 / Math.sqrt(fortune.length)).toFixed(2)}cqmin)`;

  return (
    <div className="w-full h-full" style={{ containerType: "size" }}>
      <style>{`
        @keyframes fortune-in {
          0% { opacity: 0; transform: translateY(6%) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div
        className="w-full h-full flex flex-col items-center justify-center gap-[4cqh] px-[8cqw] text-center select-none cursor-pointer overflow-hidden"
        onClick={draw}
        role="button"
        tabIndex={0}
        aria-label="Draw a new fortune"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            draw();
          }
        }}
      >
        <span
          className="leading-none"
          style={{ fontSize: "14cqmin", opacity: 0.55 }}
          aria-hidden
        >
          🥠
        </span>
        <p
          key={tick}
          className="font-medium leading-snug text-balance"
          style={{
            color: "hsl(var(--foreground))",
            fontSize,
            animation: "fortune-in 0.4s ease-out",
          }}
        >
          {fortune}
        </p>
      </div>
    </div>
  );
}
