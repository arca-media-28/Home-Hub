import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Coverage for the Aquarium fun tile.
//
// The tile is purely cosmetic: an animated SVG fish tank that fills the tile,
// with fish species / sand color / decoration props persisted in tileSettings.
// This verifies the settings round-trip through the API whitelist, the tile
// renders its tank SVG on the dashboard, and the fish/prop population scales
// with tile size (a big tile shows more fish than the small-tile minimum).
// ---------------------------------------------------------------------------

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

test("aquarium tile persists settings and renders a populated tank", async ({
  page,
}) => {
  const username = `aquatest_${rand()}`;
  const password = `Pw_${rand()}!`;

  const reg = await page.request.post("/api/auth/register", {
    data: { username, password },
  });
  expect(reg.ok(), `register failed: ${reg.status()}`).toBeTruthy();
  const { token } = (await reg.json()) as { token: string };
  const authHeaders = { Authorization: `Bearer ${token}` };

  // Seed a large aquarium tile with explicit settings.
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "aquarium",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 6,
      tileSettings: {
        aquariumFishTypes: ["goldfish", "betta", "pufferfish"],
        aquariumSandColor: "#c08552",
        aquariumProps: ["castle", "anchor", "chest"],
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();
  const tile = (await res.json()) as {
    id: number;
    tileSettings: {
      aquariumFishTypes: string[] | null;
      aquariumSandColor: string | null;
      aquariumProps: string[] | null;
    };
  };

  // Settings must survive the server-side tileSettings whitelist.
  expect(tile.tileSettings.aquariumFishTypes).toEqual([
    "goldfish",
    "betta",
    "pufferfish",
  ]);
  expect(tile.tileSettings.aquariumSandColor).toBe("#c08552");
  expect(tile.tileSettings.aquariumProps).toEqual(["castle", "anchor", "chest"]);

  // Load the dashboard authenticated and find the rendered tank.
  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");
  const tank = page.getByRole("img", { name: "Aquarium" });
  await expect(tank).toBeVisible();

  // The custom sand hex is painted on the floor path.
  await expect(tank.locator('path[fill="#c08552"]')).toHaveCount(1);

  // Fish population scales with pixel area: a 6x6 tile is large, so there
  // must be more than the small-tile minimum of 2 fish.
  const fishCount = await tank.locator("g.aq-fish").count();
  expect(fishCount).toBeGreaterThan(2);

  // Ambient bubble streams rise from the sand (pure CSS animation, always on).
  const bubbleCount = await tank.locator("g.aq-bubble").count();
  expect(bubbleCount).toBeGreaterThanOrEqual(2);

  // At least one decoration prop is on the sand (castle base rects render as
  // fill #a9a29a, anchor strokes #6b7683, chest fill #8a5a2b).
  const propMarkup = await tank.innerHTML();
  expect(
    propMarkup.includes("#a9a29a") ||
      propMarkup.includes("#6b7683") ||
      propMarkup.includes("#8a5a2b"),
  ).toBe(true);
});
