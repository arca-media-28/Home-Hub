import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Coverage for the ErsatzTV status tile's embedded TV guide + channel remote.
//
// Verifies: (1) the guide metric is opt-in — a tile with a null metric
// selection renders no guide; (2) with the guide metric on and a mocked real
// lineup, the DirecTV-style grid renders inline on the tile; (3) with a Video
// Player tile (source: ErsatzTV) on the same page, clicking a guide channel
// re-tunes that player (tuning banner + persisted videoErsatzChannel); and
// (4) with no eligible player, guide channels render without any click
// affordance.
// ---------------------------------------------------------------------------

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function register(page: import("@playwright/test").Page) {
  const username = `ersatzguide_${rand()}`;
  const password = `Pw_${rand()}!`;
  const reg = await page.request.post("/api/auth/register", {
    data: { username, password },
  });
  expect(reg.ok(), `register failed: ${reg.status()}`).toBeTruthy();
  const { token } = (await reg.json()) as { token: string };
  return { token, authHeaders: { Authorization: `Bearer ${token}` } };
}

async function seedErsatzTile(
  page: import("@playwright/test").Page,
  authHeaders: Record<string, string>,
  metrics: string[] | null,
) {
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "ersatztv",
      name: "ErsatzTV",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 6,
      metrics,
    },
    headers: authHeaders,
  });
  expect(res.ok(), `ersatztv tile create failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: number };
}

async function seedPlayerTile(
  page: import("@playwright/test").Page,
  authHeaders: Record<string, string>,
  channel: string,
) {
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 6,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: "ersatztv",
        videoErsatzChannel: channel,
        videoMuted: true,
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `player tile create failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as { id: number };
}

async function mockErsatz(page: import("@playwright/test").Page) {
  const now = Date.now();
  const iso = (min: number) => new Date(now + min * 60_000).toISOString();
  await page.route("**/api/widgets/ersatztv", (route) =>
    route.fulfill({
      json: {
        reachable: true,
        activeStreams: 1,
        channels: [
          { number: "1", name: "Movies", nowPlaying: "The Maltese Falcon" },
          { number: "2", name: "Cartoons", nowPlaying: "Looney Tunes" },
        ],
      },
    }),
  );
  await page.route("**/api/widgets/ersatztv/channels", (route) =>
    route.fulfill({
      json: {
        sample: false,
        channels: [
          {
            number: "1",
            name: "Movies",
            nowPlaying: "The Maltese Falcon",
            nowPlayingStart: iso(-30),
            nowPlayingStop: iso(30),
            programs: [
              { title: "The Maltese Falcon", start: iso(-30), stop: iso(30) },
              { title: "Casablanca", start: iso(30), stop: iso(120) },
            ],
            streamUrl: "/api/widgets/ersatztv/stream/iptv/channel/1.m3u8",
          },
          {
            number: "2",
            name: "Cartoons",
            nowPlaying: "Looney Tunes",
            programs: [],
            streamUrl: "/api/widgets/ersatztv/stream/iptv/channel/2.m3u8",
          },
        ],
      },
    }),
  );
  await page.route("**/api/widgets/ersatztv/stream/**", () => {
    /* never fulfilled — keeps hls.js loading so no fatal playback errors */
  });
}

async function openDashboard(page: import("@playwright/test").Page, token: string) {
  await page.goto("/");
  await page.evaluate((t) => localStorage.setItem("token", t), token);
  await page.goto("/");
}

test("guide is opt-in: default metric selection renders no guide", async ({ page }) => {
  const { token, authHeaders } = await register(page);
  await seedErsatzTile(page, authHeaders, null);
  await mockErsatz(page);
  await openDashboard(page, token);

  // The tile renders its normal sections…
  await expect(page.getByText("Active streams")).toBeVisible({ timeout: 15000 });
  // …but no embedded guide.
  await expect(page.getByTestId("ersatztv-tile-guide")).toHaveCount(0);
});

test("guide metric renders the grid inline and remotes an ErsatzTV player tile", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);
  await seedErsatzTile(page, authHeaders, [
    "health",
    "activeStreams",
    "nowPlaying",
    "guide",
  ]);
  const player = await seedPlayerTile(page, authHeaders, "2");
  await mockErsatz(page);
  await openDashboard(page, token);

  // Inline guide: grid, now-line, programme blocks, airing highlight.
  await expect(page.getByTestId("ersatztv-tile-guide")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("ersatztv-tile-guide-grid")).toBeVisible();
  await expect(page.getByTestId("ersatztv-tile-guide-nowline")).toBeAttached();
  const airing = page.locator(
    '[data-testid="ersatztv-tile-guide-program"][data-airing="true"]',
  );
  await expect(airing).toHaveCount(1);
  await expect(airing).toContainText("The Maltese Falcon");

  // The player's tuned channel (2) is highlighted as current in the guide.
  const entries = page.getByTestId("ersatztv-tile-channel-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(1)).toHaveAttribute("data-current", "true");

  // Remote: click channel 1 → player shows its tuning banner for channel 1
  // and the change is persisted on the player tile.
  await entries.nth(0).click();
  const banner = page.getByTestId("videoplayer-tuning-banner");
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText("Movies");
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tiles", { headers: authHeaders });
      const tiles = (await res.json()) as {
        id: number;
        tileSettings?: { videoErsatzChannel?: string | null };
      }[];
      return (
        tiles.find((t) => t.id === player.id)?.tileSettings
          ?.videoErsatzChannel ?? null
      );
    })
    .toBe("1");
});

test("without an eligible player the guide has no click affordance", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);
  await seedErsatzTile(page, authHeaders, ["nowPlaying", "guide"]);
  await mockErsatz(page);
  await openDashboard(page, token);

  await expect(page.getByTestId("ersatztv-tile-guide")).toBeVisible({ timeout: 15000 });
  const entries = page.getByTestId("ersatztv-tile-channel-entry");
  await expect(entries).toHaveCount(2);
  // Channel cells are plain divs, not buttons — nothing to click.
  for (const el of await entries.all()) {
    expect(await el.evaluate((node) => node.tagName)).toBe("DIV");
  }
  // The airing programme block is a span, not a button.
  const airing = page.locator(
    '[data-testid="ersatztv-tile-guide-program"][data-airing="true"]',
  );
  await expect(airing).toHaveCount(1);
  expect(await airing.evaluate((node) => node.tagName)).toBe("SPAN");
});
