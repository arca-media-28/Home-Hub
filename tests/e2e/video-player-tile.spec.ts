import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A tiny (0.5s, 64x64) VP8 webm served in place of the fake example.com URLs
// so the <video> element actually loads instead of firing an error.
const TINY_WEBM = readFileSync(join(__dirname, "assets", "tiny.webm"));

// A 2s seekable mp4 (faststart) for the resume test — the tiny webm has no
// cue/duration data, so Chromium cannot seek within it.
const TINY_MP4 = readFileSync(join(__dirname, "assets", "tiny-seekable.mp4"));

// ---------------------------------------------------------------------------
// Coverage for the Video Player tile.
//
// Verifies the tileSettings round-trip through the API whitelist (all ten
// video* keys survive), the unconfigured tile plays the built-in yule log
// demo (muted + looped + badge), a configured URL playlist renders the real
// video with hover playback controls, and a YouTube source renders the
// embedded iframe with the parsed embed URL.
// ---------------------------------------------------------------------------

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function register(page: import("@playwright/test").Page) {
  const username = `videotest_${rand()}`;
  const password = `Pw_${rand()}!`;
  const reg = await page.request.post("/api/auth/register", {
    data: { username, password },
  });
  expect(reg.ok(), `register failed: ${reg.status()}`).toBeTruthy();
  const { token } = (await reg.json()) as { token: string };
  return { token, authHeaders: { Authorization: `Bearer ${token}` } };
}

test("video player persists settings and plays the yule log demo when unconfigured", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);

  // Seed a video-player tile with every setting so the whitelist round-trip
  // is fully exercised. videoSource stays unset → yule log demo.
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: null,
        videoUploadUrls: ["/api/uploads/files/some-video.mp4"],
        videoUrls: ["https://example.com/clip.webm"],
        videoYoutubeUrl: "https://www.youtube.com/watch?v=abc123def45",
        videoLibraryId: "42",
        videoPlayMode: "playlist",
        videoPlaylistLoop: false,
        videoShuffle: true,
        videoMuted: true,
        videoFit: "contain",
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();
  const tile = (await res.json()) as { tileSettings: Record<string, unknown> };

  // Every video* key must survive the server-side tileSettings whitelist.
  expect(tile.tileSettings.videoUploadUrls).toEqual(["/api/uploads/files/some-video.mp4"]);
  expect(tile.tileSettings.videoUrls).toEqual(["https://example.com/clip.webm"]);
  expect(tile.tileSettings.videoYoutubeUrl).toBe("https://www.youtube.com/watch?v=abc123def45");
  expect(tile.tileSettings.videoLibraryId).toBe("42");
  expect(tile.tileSettings.videoPlayMode).toBe("playlist");
  expect(tile.tileSettings.videoPlaylistLoop).toBe(false);
  expect(tile.tileSettings.videoShuffle).toBe(true);
  expect(tile.tileSettings.videoMuted).toBe(true);
  expect(tile.tileSettings.videoFit).toBe("contain");

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();

  // Unconfigured → yule log demo: badge visible, <video> muted + looped.
  await expect(tileEl.getByTestId("videoplayer-demo-badge")).toBeVisible();
  const video = tileEl.getByTestId("videoplayer-video");
  await expect(video).toBeAttached();
  expect(await video.getAttribute("data-video-id")).toBe("yule-log");
  expect(await video.evaluate((el) => (el as HTMLVideoElement).muted)).toBe(true);
  expect(await video.evaluate((el) => (el as HTMLVideoElement).loop)).toBe(true);
});

test("video player with a URL playlist shows controls and steps between videos", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);

  // Two direct URLs; the files don't need to load for the DOM assertions.
  const urls = [
    "https://example.com/first-clip.mp4",
    "https://example.com/second-clip.webm",
  ];
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: "urls",
        videoUrls: urls,
        videoPlayMode: "playlist",
        videoPlaylistLoop: true,
        videoShuffle: false,
        videoMuted: true,
        videoFit: "cover",
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();

  // Serve real (tiny) video bytes for the fake URLs so playback succeeds.
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "video/webm", body: TINY_WEBM }),
  );

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();

  // Configured source → no demo badge, first URL loaded, cover fit.
  await expect(tileEl.getByTestId("videoplayer-demo-badge")).toHaveCount(0);
  const video = tileEl.getByTestId("videoplayer-video");
  await expect(video).toBeAttached();
  expect(await video.getAttribute("src")).toBe(urls[0]);
  expect(await video.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");

  // Hover overlay: next steps to the second video, prev returns to the first.
  await tileEl.hover();
  await tileEl.getByTestId("videoplayer-next").click();
  await expect
    .poll(async () => tileEl.getByTestId("videoplayer-video").getAttribute("src"))
    .toBe(urls[1]);
  await tileEl.hover();
  await tileEl.getByTestId("videoplayer-prev").click();
  await expect
    .poll(async () => tileEl.getByTestId("videoplayer-video").getAttribute("src"))
    .toBe(urls[0]);

  // Mute toggle flips the underlying <video>.
  await tileEl.hover();
  await tileEl.getByTestId("videoplayer-mute").click();
  expect(
    await tileEl
      .getByTestId("videoplayer-video")
      .evaluate((el) => (el as HTMLVideoElement).muted),
  ).toBe(false);
});

test("video player with a YouTube source renders the embed iframe", async ({ page }) => {
  const { token, authHeaders } = await register(page);

  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: "youtube",
        videoYoutubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        videoPlayMode: "single",
        videoMuted: true,
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();
  const iframe = tileEl.getByTestId("videoplayer-youtube");
  await expect(iframe).toBeVisible();
  const src = (await iframe.getAttribute("src")) ?? "";
  expect(src).toContain("youtube.com/embed/dQw4w9WgXcQ");
  expect(src).toContain("mute=1");
  // Single mode loops via playlist=<same id>.
  expect(src).toContain("loop=1");
  expect(src).toContain("playlist=dQw4w9WgXcQ");
});

test("a configured video URL that fails to load shows the error state, not the yule log", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);

  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: "urls",
        videoUrls: ["https://example.com/broken-clip.mp4"],
        videoMuted: true,
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();

  // The configured media URL 404s → the <video> fires an error.
  await page.route("https://example.com/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }),
  );

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();

  // Explicit error state — and definitely no silent yule-log fallback.
  await expect(tileEl.getByTestId("videoplayer-error")).toBeVisible();
  await expect(tileEl.getByTestId("videoplayer-error")).toContainText("failed to load");
  await expect(tileEl.getByTestId("videoplayer-demo-badge")).toHaveCount(0);
  await expect(tileEl.getByTestId("videoplayer-video")).toHaveCount(0);
});

test("video playback position and playlist spot survive switching dashboard pages", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);

  // A second page to switch away to (the first page exists by default).
  const pageRes = await page.request.post("/api/pages", {
    data: { name: "Second" },
    headers: authHeaders,
  });
  expect(pageRes.ok(), `page create failed: ${pageRes.status()}`).toBeTruthy();

  const urls = [
    "https://example.com/first-clip.mp4",
    "https://example.com/second-clip.mp4",
  ];
  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 5,
      tileSettings: {
        videoSource: "urls",
        videoUrls: urls,
        videoPlayMode: "playlist",
        videoPlaylistLoop: true,
        videoShuffle: false,
        videoMuted: true,
      },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();

  // Serve the mp4 WITH range-request support: Chromium marks a media
  // resource unseekable (seekable end = 0) when the server ignores Range
  // headers, which would make currentTime assignments silently no-op.
  await page.route("https://example.com/**", (route) => {
    const range = route.request().headers()["range"];
    const m = range?.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), TINY_MP4.length - 1) : TINY_MP4.length - 1;
      return route.fulfill({
        status: 206,
        contentType: "video/mp4",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${TINY_MP4.length}`,
        },
        body: TINY_MP4.subarray(start, end + 1),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "video/mp4",
      headers: { "Accept-Ranges": "bytes" },
      body: TINY_MP4,
    });
  });

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();

  // Pause FIRST (the clip is only 2s — left playing it would end and
  // auto-advance, racing the assertions), then step to the SECOND playlist
  // entry and seek, so both the playlist position and the timestamp have
  // non-default values to remember.
  await tileEl.hover();
  await tileEl.getByTestId("videoplayer-playpause").click();
  await expect
    .poll(async () =>
      tileEl.getByTestId("videoplayer-video").evaluate((el) => (el as HTMLVideoElement).paused),
    )
    .toBe(true);
  await tileEl.hover();
  await tileEl.getByTestId("videoplayer-next").click();
  await expect
    .poll(async () => tileEl.getByTestId("videoplayer-video").getAttribute("src"))
    .toBe(urls[1]);
  await tileEl.getByTestId("videoplayer-video").evaluate((el) => {
    (el as HTMLVideoElement).currentTime = 0.3;
  });
  await expect
    .poll(async () =>
      tileEl
        .getByTestId("videoplayer-video")
        .evaluate((el) => (el as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThanOrEqual(0.29);

  // Switch to the second page — the tile unmounts entirely.
  await page.getByRole("button", { name: "Second", exact: true }).click();
  await expect(tileEl).toHaveCount(0);

  // Switch back: the SAME playlist entry resumes near the saved timestamp
  // instead of restarting from the first video at 0:00.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(tileEl).toBeVisible();
  const video = tileEl.getByTestId("videoplayer-video");
  await expect(video).toBeAttached();
  await expect.poll(async () => video.getAttribute("src")).toBe(urls[1]);
  await expect
    .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).currentTime))
    .toBeGreaterThanOrEqual(0.29);
});

test("videoplayer sample mode reports unconfigured Plex, tile shows yule log", async ({
  page,
}) => {
  const { token, authHeaders } = await register(page);

  // Unconfigured Plex → sample:true, empty playlist (never an error).
  const playlist = await page.request.get("/api/widgets/videoplayer?server=plex", {
    headers: authHeaders,
  });
  expect(playlist.ok()).toBeTruthy();
  const body = (await playlist.json()) as { sample?: boolean; videos: unknown[] };
  expect(body.sample).toBe(true);
  expect(body.videos).toEqual([]);

  const res = await page.request.post("/api/tiles", {
    data: {
      type: "integration",
      integration: "videoplayer",
      name: "",
      gridX: 0,
      gridY: 0,
      gridW: 5,
      gridH: 4,
      tileSettings: { videoSource: "plex", videoLibraryId: "1" },
    },
    headers: authHeaders,
  });
  expect(res.ok(), `tile create failed: ${res.status()}`).toBeTruthy();

  await page.addInitScript((t) => localStorage.setItem("token", t), token);
  await page.goto("/");

  const tileEl = page.getByTestId("videoplayer-tile");
  await expect(tileEl).toBeVisible();
  await expect(tileEl.getByTestId("videoplayer-demo-badge")).toBeVisible();
  await expect(tileEl.getByTestId("videoplayer-error")).toHaveCount(0);
});
