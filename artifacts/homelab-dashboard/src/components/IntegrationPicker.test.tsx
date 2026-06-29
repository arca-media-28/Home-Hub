// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";

// IntegrationPicker pulls integration display metadata from integrationMeta,
// which reads the TileIntegration enum at module load. Mock the workspace
// client so the enum (values equal their keys) is available without dragging in
// the generated API client. ServiceStatus is a type-only import (erased), so it
// needs no runtime stub.
vi.mock("@workspace/api-client-react", () => ({
  TileIntegration: {
    media: "media",
    jellyfin: "jellyfin",
    sonarr: "sonarr",
    radarr: "radarr",
    lidarr: "lidarr",
    qbittorrent: "qbittorrent",
    truenas: "truenas",
    pihole: "pihole",
    "nginx-proxy-manager": "nginx-proxy-manager",
    prowlarr: "prowlarr",
    tailscale: "tailscale",
    ersatztv: "ersatztv",
    audioplayer: "audioplayer",
    clock: "clock",
    timer: "timer",
    weather: "weather",
    sports: "sports",
    sleeper: "sleeper",
    news: "news",
    stocks: "stocks",
    eightball: "eightball",
    dice: "dice",
    coinflip: "coinflip",
    fortune: "fortune",
    tamagotchi: "tamagotchi",
    bonsai: "bonsai",
    note: "note",
    spacer: "spacer",
    divider: "divider",
  },
}));

import IntegrationPicker, {
  type IntegrationOption,
} from "./IntegrationPicker";

// A small, deliberately out-of-category-order set so we can assert the picker
// regroups them into CATEGORY_ORDER (News, Media, Downloads, Server …).
const INTEGRATIONS: readonly IntegrationOption[] = [
  { value: "sonarr", label: "Sonarr" }, // Downloads
  { value: "media", label: "Plex" }, // Media
  { value: "weather", label: "Weather" }, // News
  { value: "truenas", label: "TrueNAS" }, // Server
  { value: "jellyfin", label: "Jellyfin" }, // Media
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof IntegrationPicker>> = {}) {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <IntegrationPicker
      open
      onOpenChange={onOpenChange}
      value="none"
      onSelect={onSelect}
      integrations={INTEGRATIONS}
      {...overrides}
    />,
  );
  return { onSelect, onOpenChange };
}

// The label text of a card is rendered in its own span; the button is the
// nearest ancestor button. Using exact text avoids matching the longer
// description blurb that may also contain the integration name.
function cardButton(label: string): HTMLButtonElement {
  const btn = screen.getByText(label, { exact: true }).closest("button");
  expect(btn, `no card button for "${label}"`).toBeTruthy();
  return btn as HTMLButtonElement;
}

const searchBox = () => screen.getByLabelText("Search integrations");

beforeEach(() => {
  // requestAnimationFrame is used to scroll the selected card into view; jsdom
  // doesn't provide it, and scrollIntoView is not implemented either.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("IntegrationPicker", () => {
  it("renders the cards grouped into category sections in order", () => {
    renderPicker();

    // Every supplied integration renders a card.
    for (const i of INTEGRATIONS) {
      expect(cardButton(i.label)).toBeTruthy();
    }

    // Category headings appear in CATEGORY_ORDER, and empty categories are
    // omitted (only the categories represented by our integrations show).
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["News", "Media", "Downloads", "Server"]);
  });

  it("includes a selectable None card", () => {
    const { onSelect, onOpenChange } = renderPicker();

    const none = cardButton("None");
    expect(none).toBeTruthy();

    fireEvent.click(none);
    expect(onSelect).toHaveBeenCalledWith("none", undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("filters cards by name as the user types", () => {
    renderPicker();

    fireEvent.change(searchBox(), { target: { value: "plex" } });

    // Only the matching card remains; non-matches and the None card disappear.
    expect(screen.getByText("Plex", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Sonarr", { exact: true })).toBeNull();
    expect(screen.queryByText("Jellyfin", { exact: true })).toBeNull();
    expect(screen.queryByText("None", { exact: true })).toBeNull();
  });

  it("shows an empty-state message when nothing matches", () => {
    renderPicker();

    fireEvent.change(searchBox(), { target: { value: "zzzznope" } });

    expect(screen.getByText(/No integrations match/i)).toBeTruthy();
    expect(screen.queryByText("Plex", { exact: true })).toBeNull();
  });

  it("calls onSelect with the chosen value and closes when a card is clicked", () => {
    const { onSelect, onOpenChange } = renderPicker();

    fireEvent.click(cardButton("Sonarr"));

    expect(onSelect).toHaveBeenCalledWith("sonarr", undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the selected card as pressed and leaves the rest unpressed", () => {
    renderPicker({ value: "media" });

    expect(cardButton("Plex").getAttribute("aria-pressed")).toBe("true");
    expect(cardButton("Sonarr").getAttribute("aria-pressed")).toBe("false");
    expect(cardButton("None").getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the variant sub-view instead of selecting when an integration has sub-options", () => {
    const { onSelect, onOpenChange } = renderPicker({
      subOptions: {
        truenas: [
          { key: "cpu", label: "CPU load" },
          { key: "disk", label: "Disk usage" },
        ],
      },
    });

    fireEvent.click(cardButton("TrueNAS"));

    // No selection yet; instead the second pop-out lists the variants.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText("CPU load")).toBeTruthy();
    expect(screen.getByText("Disk usage")).toBeTruthy();

    // Choosing a variant selects the integration with its sub-key and closes.
    fireEvent.click(cardButton("Disk usage"));
    expect(onSelect).toHaveBeenCalledWith("truenas", "disk");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("draws a reachability dot from a saved connection's status", () => {
    renderPicker({
      statuses: [{ service: "truenas", configured: true, ok: false } as never],
    });

    const card = cardButton("TrueNAS");
    expect(within(card).getByLabelText("Unreachable")).toBeTruthy();
    // An integration without a saved connection shows no dot.
    expect(within(cardButton("Plex")).queryByLabelText(/Reachable/)).toBeNull();
  });
});
