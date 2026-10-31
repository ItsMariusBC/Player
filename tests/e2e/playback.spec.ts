import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth.helpers";

const RESUME_KEY = "player.resume.v1";

async function startPlayer(page: Page) {
  await loginAs(page, "user@test");
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  const slider = page.getByRole("slider", { name: "Progression de la lecture" });
  await expect(activate.or(slider).first()).toBeVisible();
  if (await activate.isVisible()) await activate.click();
  await expect(activate).toHaveCount(0);
  return slider;
}

// Keyboard shortcuts only fire when nothing has the focus.
async function ensurePlaying(page: Page) {
  const body = page.locator("body");
  if (!/En lecture\s*:/.test(await body.innerText())) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
  }
  await expect(body).toContainText(/En lecture\s*:/);
}

async function currentTitle(page: Page): Promise<string> {
  const text = await page.locator("body").innerText();
  const match = /En (?:lecture|pause)\s*:\s*(.+)/.exec(text);
  if (!match) throw new Error("current track hint not found");
  return match[1].trim();
}

async function seekToPercent(page: Page, percent: number) {
  const slider = page.getByRole("slider", { name: "Progression de la lecture" });
  // The progress only moves once the duration is known (metadata loaded): a click
  // before that is dropped. Click again inside the poll until it lands.
  await expect
    .poll(
      async () => {
        if ((await sliderValue(page)) < percent - 5) {
          const box = await slider.boundingBox();
          if (box) await slider.click({ position: { x: (box.width * percent) / 100, y: 2 } });
        }
        return sliderValue(page);
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(percent - 5);
}

const sliderValue = async (page: Page) =>
  Number(
    await page
      .getByRole("slider", { name: "Progression de la lecture" })
      .getAttribute("aria-valuenow"),
  );

test("a reload resumes the same track near the same position, paused", async ({ page }) => {
  test.setTimeout(60_000);
  await startPlayer(page);
  await ensurePlaying(page);
  const title = await currentTitle(page);

  // Fixtures last 30 s: 60 % is about 18 s, past the 5 s threshold.
  await seekToPercent(page, 60);
  await expect.poll(() => sliderValue(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(55);
  // The position is saved every 2 s: wait for a stored value close to the target.
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as { position: number }).position : 0;
        }, RESUME_KEY),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(15);
  const before = await sliderValue(page);

  await page.reload();
  await expect(page.locator("body")).toContainText(`En pause : ${title}`);
  // 3 s on a 30 s track is 10 %.
  await expect
    .poll(() => sliderValue(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before - 10);
  expect(await sliderValue(page)).toBeLessThanOrEqual(before + 10);
});

test("the Media Session metadata follows the current track", async ({ page }) => {
  await startPlayer(page);
  await ensurePlaying(page);
  const title = await currentTitle(page);
  await expect
    .poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title ?? null))
    .toBe(title);
});

test("the next track is requested while the current one plays", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await startPlayer(page);
  await ensurePlaying(page);
  const title = await currentTitle(page);

  const catalog = await page.request.get("/api/catalog");
  const { tracks } = (await catalog.json()) as { tracks: { id: string; name: string }[] };
  const others = tracks.filter((track) => track.name !== title).map((track) => track.id);
  expect(others.length).toBeGreaterThan(0);

  // The preload starts a few seconds into the track.
  await expect
    .poll(
      () =>
        page.evaluate(
          (ids) =>
            performance
              .getEntriesByType("resource")
              .some((entry) => ids.some((id) => entry.name.includes(`/api/media/${id}`))),
          others,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Next track from the keyboard (nothing is focused): the title switches and
  // the new track plays on, without any page error.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => currentTitle(page), { timeout: 10_000 }).not.toBe(title);
  await expect(page.locator("body")).toContainText(/En lecture\s*:/);
  const start = await sliderValue(page);
  await expect.poll(() => sliderValue(page), { timeout: 10_000 }).toBeGreaterThan(start);
  expect(errors).toEqual([]);
});
