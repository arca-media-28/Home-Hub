import { useState, useEffect, useRef } from "react";

type Side = "Heads" | "Tails";

function flipResult(): Side {
  return Math.random() < 0.5 ? "Heads" : "Tails";
}

// A self-contained coin-flip toy. Clicking the tile "flips" a coin that spins
// and lands on Heads or Tails. No backend, no connection — entirely
// client-side. The coin and label scale to the tile via CSS container-query
// units (cqw/cqh/cqmin) so they fill any tile dimension.
export default function CoinFlipTile() {
  const [side, setSide] = useState<Side>(() => flipResult());
  const [flipping, setFlipping] = useState(false);
  const swapTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);

  function clearTimers() {
    if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    swapTimer.current = null;
    stopTimer.current = null;
  }

  function flip() {
    clearTimers();
    setFlipping(true);
    // Settle on the new face partway through the spin so it lands cleanly.
    swapTimer.current = window.setTimeout(() => setSide(flipResult()), 500);
    stopTimer.current = window.setTimeout(() => setFlipping(false), 800);
  }

  // Flip once on mount so the tile shows a result immediately.
  useEffect(() => {
    setFlipping(true);
    stopTimer.current = window.setTimeout(() => setFlipping(false), 800);
    return clearTimers;
  }, []);

  const isHeads = side === "Heads";

  return (
    <div className="w-full h-full" style={{ containerType: "size" }}>
      <style>{`
        @keyframes coin-flip {
          0% { transform: rotateX(0deg) translateY(0); }
          50% { transform: rotateX(900deg) translateY(-22%); }
          100% { transform: rotateX(1800deg) translateY(0); }
        }
        @keyframes coin-label-in {
          0% { opacity: 0; transform: translateY(20%); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        className="w-full h-full flex flex-col items-center justify-center gap-[5cqh] select-none cursor-pointer overflow-hidden"
        onClick={flip}
        role="button"
        tabIndex={0}
        aria-label="Flip the coin"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            flip();
          }
        }}
        style={{ perspective: "600px" }}
      >
        {/* The coin: a disc sized to the smaller tile dimension. */}
        <div
          className="relative rounded-full flex items-center justify-center"
          style={{
            width: "min(58cqw, 58cqh)",
            height: "min(58cqw, 58cqh)",
            background: isHeads
              ? "radial-gradient(circle at 34% 28%, #ffe79a 0%, #f5c542 45%, #b8860b 100%)"
              : "radial-gradient(circle at 34% 28%, #e8e8ee 0%, #c2c2cc 45%, #8a8a96 100%)",
            boxShadow:
              "inset 0 -4cqmin 8cqmin rgba(0,0,0,0.35), inset 0 3cqmin 6cqmin rgba(255,255,255,0.6), 0 4cqmin 9cqmin rgba(0,0,0,0.4)",
            border: "0.8cqmin solid rgba(0,0,0,0.18)",
            animation: flipping
              ? "coin-flip 0.8s cubic-bezier(.36,.07,.19,.97)"
              : "none",
          }}
        >
          <span
            className="font-bold leading-none"
            style={{
              color: isHeads
                ? "rgba(120,80,0,0.85)"
                : "rgba(60,60,70,0.85)",
              fontSize: "26cqmin",
              textShadow: "0 0.4cqmin 0.8cqmin rgba(255,255,255,0.4)",
              opacity: flipping ? 0 : 1,
            }}
          >
            {isHeads ? "H" : "T"}
          </span>
        </div>

        <span
          key={side}
          className="font-bold uppercase tracking-widest leading-none"
          style={{
            color: "hsl(var(--foreground))",
            fontSize: "8cqmin",
            opacity: flipping ? 0.3 : 1,
            animation: flipping ? "none" : "coin-label-in 0.35s ease-out",
          }}
        >
          {side}
        </span>
      </div>
    </div>
  );
}
