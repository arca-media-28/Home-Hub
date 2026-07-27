// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Coverage for the Pterodactyl tile's per-row power controls: buttons are
// contextual to the server's power state (start when offline, stop/restart
// when running, spinner while transitioning), clicking one fires the power
// mutation with the right signal, and edit mode hides the controls entirely
// so they can't fight drag/resize.
// ---------------------------------------------------------------------------

const { powerMutate } = vi.hoisted(() => ({ powerMutate: vi.fn() }));

// Servers the mocked widget hook returns. Set per test.
let mockServers: Array<{
  id: string;
  name: string;
  state: string;
  cpuPercent: number | null;
  memUsedMb: number | null;
  memLimitMb: number | null;
  players: { current: number; max: number | null } | null;
  playersUnavailableReason?: string | null;
}> = [];

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetPterodactylWidget: () => ({
    data: { servers: mockServers },
    isLoading: false,
    isError: false,
  }),
  getGetPterodactylWidgetQueryKey: () => ["/api/widgets/pterodactyl"],
  useSendPterodactylPower: () => ({ mutate: powerMutate }),
  PterodactylPowerRequestSignal: { start: "start", stop: "stop", restart: "restart" },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import PterodactylTile from "./PterodactylTile";
import { tileDensity, resolveEnabledMetrics } from "./metrics";

function renderTile({ editMode = false }: { editMode?: boolean } = {}) {
  return render(
    <PterodactylTile
      enabled={resolveEnabledMetrics("pterodactyl", null)}
      density={tileDensity(6, 6, { width: 320, height: 360 }, false, false)}
      tileSettings={null}
      integration="pterodactyl"
      editMode={editMode}
    />,
  );
}

beforeEach(() => {
  powerMutate.mockClear();
  mockServers = [
    { id: "run1", name: "Minecraft", state: "running", cpuPercent: 12, memUsedMb: 1024, memLimitMb: 4096, players: { current: 2, max: 20 } },
    { id: "off1", name: "Valheim", state: "offline", cpuPercent: 0, memUsedMb: 0, memLimitMb: 4096, players: null },
    { id: "boot1", name: "Terraria", state: "starting", cpuPercent: 1, memUsedMb: 128, memLimitMb: 2048, players: null },
  ];
});

afterEach(() => cleanup());

describe("PterodactylTile power controls", () => {
  it("shows contextual buttons per state in locked mode", () => {
    renderTile();
    // Running server → stop + restart, no start.
    expect(screen.getByLabelText("Stop Minecraft")).toBeTruthy();
    expect(screen.getByLabelText("Restart Minecraft")).toBeTruthy();
    expect(screen.queryByLabelText("Start Minecraft")).toBeNull();
    // Offline server → start only.
    expect(screen.getByLabelText("Start Valheim")).toBeTruthy();
    expect(screen.queryByLabelText("Stop Valheim")).toBeNull();
    // Transitioning server → spinner instead of buttons.
    expect(screen.queryByLabelText(/Terraria/)).toBeNull();
  });

  it("sends the matching power signal when a button is clicked", () => {
    renderTile();
    fireEvent.click(screen.getByLabelText("Start Valheim"));
    expect(powerMutate).toHaveBeenCalledWith({
      data: { serverId: "off1", signal: "start" },
    });
  });

  it("asks before stop/restart when players are online, and confirms/cancels", () => {
    renderTile();
    // Minecraft has 2 players connected — restart must NOT fire immediately.
    fireEvent.click(screen.getByLabelText("Restart Minecraft"));
    expect(powerMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Restart? 2 online")).toBeTruthy();

    // Cancel restores the buttons without sending anything.
    fireEvent.click(screen.getByLabelText("Cancel restart Minecraft"));
    expect(powerMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Restart Minecraft")).toBeTruthy();

    // Stop asks too; confirming sends the signal.
    fireEvent.click(screen.getByLabelText("Stop Minecraft"));
    expect(powerMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm stop Minecraft"));
    expect(powerMutate).toHaveBeenCalledWith({
      data: { serverId: "run1", signal: "stop" },
    });
  });

  it("shows a pending spinner on the acted-upon row until state changes", () => {
    renderTile();
    fireEvent.click(screen.getByLabelText("Stop Minecraft"));
    fireEvent.click(screen.getByLabelText("Confirm stop Minecraft"));
    // The row's buttons are replaced by a spinner while the action is pending.
    expect(screen.queryByLabelText("Stop Minecraft")).toBeNull();
    expect(screen.queryByLabelText("Restart Minecraft")).toBeNull();
  });

  it("hides all power controls in edit mode", () => {
    renderTile({ editMode: true });
    expect(screen.queryByLabelText("Stop Minecraft")).toBeNull();
    expect(screen.queryByLabelText("Restart Minecraft")).toBeNull();
    expect(screen.queryByLabelText("Start Valheim")).toBeNull();
  });
});

describe("PterodactylTile players-unavailable state", () => {
  it("shows a dash with an explanatory tooltip when a running server has no player count", () => {
    mockServers = [
      {
        id: "run1",
        name: "Minecraft",
        state: "running",
        cpuPercent: 12,
        memUsedMb: 1024,
        memLimitMb: 4096,
        players: null,
        playersUnavailableReason: "timeout",
      },
    ];
    renderTile();
    const indicator = screen.getByLabelText("Players unavailable for Minecraft");
    expect(indicator.textContent).toContain("—");
    expect(indicator.getAttribute("title")).toMatch(/query port/i);
  });

  it("hides the indicator for non-running servers and when players are present", () => {
    mockServers = [
      { id: "off1", name: "Valheim", state: "offline", cpuPercent: 0, memUsedMb: 0, memLimitMb: 4096, players: null, playersUnavailableReason: null },
      { id: "run1", name: "Minecraft", state: "running", cpuPercent: 12, memUsedMb: 1024, memLimitMb: 4096, players: { current: 2, max: 20 }, playersUnavailableReason: null },
    ];
    renderTile();
    expect(screen.queryByLabelText(/Players unavailable/)).toBeNull();
    // The normal player count still renders.
    expect(screen.getByTitle("Players online").textContent).toContain("2");
  });

  it("keeps the reason-specific tooltips distinct per failure category", () => {
    mockServers = [
      { id: "r1", name: "Alpha", state: "running", cpuPercent: 1, memUsedMb: 1, memLimitMb: 4096, players: null, playersUnavailableReason: "unknown-game" },
      { id: "r2", name: "Beta", state: "running", cpuPercent: 1, memUsedMb: 1, memLimitMb: 4096, players: null, playersUnavailableReason: "unreachable" },
    ];
    renderTile();
    expect(
      screen.getByLabelText("Players unavailable for Alpha").getAttribute("title"),
    ).toMatch(/recognized/i);
    expect(
      screen.getByLabelText("Players unavailable for Beta").getAttribute("title"),
    ).toMatch(/reached/i);
  });
});
