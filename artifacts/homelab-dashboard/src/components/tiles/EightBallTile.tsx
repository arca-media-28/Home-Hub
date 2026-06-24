import { useState, useEffect, useRef } from "react";

// The 20 classic Magic 8 Ball answers: 10 affirmative, 5 non-committal,
// 5 negative.
const ANSWERS = [
  // Affirmative (10)
  "It is certain",
  "It is decidedly so",
  "Without a doubt",
  "Yes definitely",
  "You may rely on it",
  "As I see it, yes",
  "Most likely",
  "Outlook good",
  "Yes",
  "Signs point to yes",
  // Non-committal (5)
  "Reply hazy, try again",
  "Ask again later",
  "Better not tell you now",
  "Cannot predict now",
  "Concentrate and ask again",
  // Negative (5)
  "Don't count on it",
  "My reply is no",
  "My sources say no",
  "Outlook not so good",
  "Very doubtful",
] as const;

function randomAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

// A self-contained Magic Eight Ball toy. Clicking the tile "shakes" the ball
// and reveals a new random answer. No backend, no connection — entirely
// client-side. The ball and its answer text scale to the tile via CSS
// container-query units (cqw/cqh/cqmin) so it fills any tile dimension.
export default function EightBallTile() {
  const [answer, setAnswer] = useState<string>(() => randomAnswer());
  const [shaking, setShaking] = useState(false);
  const swapTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);

  function clearTimers() {
    if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    swapTimer.current = null;
    stopTimer.current = null;
  }

  function shake() {
    clearTimers();
    setShaking(true);
    // Pick the next answer partway through the shake so it fades in fresh.
    swapTimer.current = window.setTimeout(() => setAnswer(randomAnswer()), 300);
    stopTimer.current = window.setTimeout(() => setShaking(false), 600);
  }

  // Shake on first mount so the tile shows an answer immediately rather than
  // sitting in a blank/static state.
  useEffect(() => {
    setShaking(true);
    stopTimer.current = window.setTimeout(() => setShaking(false), 600);
    return clearTimers;
  }, []);

  // Font scales with the ball (cqmin) and shrinks for longer answers so the
  // text always fits inside the inscribed text box, capped so short answers
  // don't balloon.
  const fontSize = `min(5cqmin, ${(34 / Math.sqrt(answer.length)).toFixed(2)}cqmin)`;

  return (
    <div className="w-full h-full" style={{ containerType: "size" }}>
      <style>{`
        @keyframes eightball-shake {
          0% { transform: translate(0, 0) rotate(0deg); }
          15% { transform: translate(-6%, -3%) rotate(-6deg); }
          30% { transform: translate(6%, 3%) rotate(6deg); }
          45% { transform: translate(-5%, 4%) rotate(-4deg); }
          60% { transform: translate(5%, -4%) rotate(4deg); }
          75% { transform: translate(-3%, 2%) rotate(-2deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes eightball-answer-in {
          0% { opacity: 0; transform: scale(0.7); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div
        className="w-full h-full flex items-center justify-center select-none cursor-pointer overflow-hidden"
        onClick={shake}
        role="button"
        tabIndex={0}
        aria-label="Shake the Magic Eight Ball"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            shake();
          }
        }}
      >
        {/* The ball: a circle sized to the smaller tile dimension, so it always
            fits and scales with the tile. */}
        <div
          className="relative rounded-full"
          style={{
            width: "min(94cqw, 94cqh)",
            height: "min(94cqw, 94cqh)",
            background:
              "radial-gradient(circle at 32% 28%, #4b4b4b 0%, #1c1c1c 45%, #050505 100%)",
            boxShadow:
              "inset 0 -5cqmin 10cqmin rgba(0,0,0,0.7), 0 3cqmin 8cqmin rgba(0,0,0,0.45)",
            animation: shaking
              ? "eightball-shake 0.6s cubic-bezier(.36,.07,.19,.97)"
              : "none",
          }}
        >
          {/* Top glossy highlight */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              top: "10%",
              left: "20%",
              width: "35%",
              height: "22%",
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)",
            }}
          />

          {/* The blue triangular answer window, centered in the ball. */}
          <div
            className="absolute"
            style={{
              top: "50%",
              left: "50%",
              width: "60%",
              height: "60%",
              transform: "translate(-50%, -50%)",
              clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
              background:
                "radial-gradient(circle at 50% 75%, #1f3a8a 0%, #0a153f 70%, #060b24 100%)",
            }}
          />

          {/* The answer text. Its bounding box is a rectangle inscribed in the
              lower (wide) half of the triangle window so the text never spills
              past the triangle's slanted edges and gets clipped. */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              left: "50%",
              top: "66%",
              width: "30%",
              height: "22%",
              transform: "translate(-50%, -50%)",
            }}
          >
            <span
              key={answer}
              className="font-bold uppercase tracking-tight leading-tight text-center"
              style={{
                color: "#dce6ff",
                fontSize,
                animation: shaking
                  ? "none"
                  : "eightball-answer-in 0.35s ease-out",
                textShadow: "0 0.3cqmin 0.8cqmin rgba(0,0,0,0.9)",
              }}
            >
              {answer}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
