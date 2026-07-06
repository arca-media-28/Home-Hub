import type { ReactNode } from "react";

// Shared wrapper that vertically centers a live tile's enabled content within
// its measured bounding box while preserving the top-to-bottom metric-priority
// order of its children.
//
// How it behaves:
// - When only fixed-height blocks remain (e.g. a stats row after the list is
//   toggled off), `justify-center` centers them as a group instead of pinning
//   them to the top edge.
// - When a growing section opts into `flex-1` (a list that should fill the
//   remaining space), that child consumes the free space so the group fills the
//   box top-to-bottom; `justify-center` then has nothing to distribute, so the
//   list still scales to the available room.
// - Conditionally-rendered sections collapse cleanly: `gap` only applies between
//   rendered children, so turning a metric off leaves no leftover empty band.
//
// Keeping this in one place lets every centered tile behave consistently instead
// of copy-pasting the same flex classes.
export function CenteredTileBody({
  children,
  className = "",
  gap = "gap-3",
  padding = "p-3",
}: {
  children: ReactNode;
  className?: string;
  gap?: string;
  padding?: string;
}) {
  return (
    <div
      className={`flex h-full w-full flex-col justify-center ${gap} ${padding} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
