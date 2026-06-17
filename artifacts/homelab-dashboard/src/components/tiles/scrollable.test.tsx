// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Tile } from "@workspace/api-client-react";
import AppTile from "./AppTile";
import IntegrationTile from "./IntegrationTile";

// ---------------------------------------------------------------------------
// Coverage for the per-tile "Scrollable content" toggle (tileSettings.scrollable).
//
// When the flag is on, the tile's content layer must use overflow-auto so an
// overlong widget scrolls instead of being clipped at the tile edge. When off,
// it must clip exactly as before (overflow-hidden). The image background layer
// must always keep its own overflow-hidden so framing is unaffected either way.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // IntegrationTile measures its body with a ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeTile(overrides: Partial<Tile>): Tile {
  return {
    id: 1,
    userId: 1,
    type: "app",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    name: "Tile",
    ...overrides,
  } as Tile;
}

describe("AppTile scrollable toggle", () => {
  it("clips by default (overflow-hidden)", () => {
    const { container } = render(<AppTile tile={makeTile({})} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-hidden");
    expect(root.className).not.toContain("overflow-auto");
  });

  it("scrolls when scrollable is on, while the image layer stays clipped", () => {
    const { container } = render(
      <AppTile
        tile={makeTile({
          imageUrl: "https://example.com/x.png",
          tileSettings: { scrollable: true },
        })}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-auto");

    // The image background wrapper keeps its own overflow-hidden regardless.
    const img = container.querySelector("img");
    const imageWrapper = img?.parentElement as HTMLElement;
    expect(imageWrapper.className).toContain("overflow-hidden");
  });
});

describe("IntegrationTile scrollable toggle", () => {
  function bodyEl(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[class*="flex-1"]');
    expect(el, "no widget body element found").toBeTruthy();
    return el as HTMLElement;
  }

  it("clips the widget body by default (overflow-hidden)", () => {
    const { container } = render(
      <IntegrationTile tile={makeTile({ integration: "clock" })} />,
    );
    const body = bodyEl(container);
    expect(body.className).toContain("overflow-hidden");
    expect(body.className).not.toContain("overflow-auto");
  });

  it("scrolls the widget body when scrollable is on", () => {
    const { container } = render(
      <IntegrationTile
        tile={makeTile({
          integration: "clock",
          tileSettings: { scrollable: true },
        })}
      />,
    );
    const body = bodyEl(container);
    expect(body.className).toContain("overflow-auto");
  });
});
