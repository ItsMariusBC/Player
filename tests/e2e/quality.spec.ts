import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs } from "./auth.helpers";

// The activation overlay covers the page: it must be dismissed before using the controls.
async function openPlayer(page: Page) {
  await loginAs(page, "user@test");
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  const slider = page.getByRole("slider", { name: "Progression de la lecture" });
  await expect(activate.or(slider).first()).toBeVisible();
  if (await activate.isVisible()) await activate.click();
  await expect(activate).toHaveCount(0);
}

const qualityButton = (page: Page) => page.locator("[data-quality-button]");

async function cycleTo(page: Page, label: string) {
  for (let i = 0; i < 3; i++) {
    if ((await qualityButton(page).innerText()).includes(label)) return;
    await qualityButton(page).click();
  }
  await expect(qualityButton(page)).toContainText(label);
}

test("the quality button cycles Auto, Max, Allégée and back", async ({ page }) => {
  await openPlayer(page);
  const button = qualityButton(page);
  await expect(button).toContainText("Qualité : Auto");
  await button.click();
  await expect(button).toContainText("Qualité : Max");
  await button.click();
  await expect(button).toContainText("Qualité : Allégée");
  await button.click();
  await expect(button).toContainText("Qualité : Auto");
});

test("the quality survives a reload", async ({ page }) => {
  await openPlayer(page);
  await cycleTo(page, "Allégée");
  await page.reload();
  await page.getByRole("button", { name: "Activer le lecteur" }).click();
  await expect(qualityButton(page)).toContainText("Qualité : Allégée");
});

test("playback requests the light stream when the quality is Allégée", async ({ page }) => {
  await openPlayer(page);
  await cycleTo(page, "Allégée");

  // The player loads the current track as soon as the page opens, with the saved setting.
  const lightResponse = page.waitForResponse(
    (r) => /\/api\/media\/[^?]+\?q=light/.test(r.url()) && r.status() < 400,
  );
  await page.reload();
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  await expect(activate).toBeVisible();
  const response = await lightResponse;
  expect([200, 206]).toContain(response.status());
  // The light variant is audio/mp4; without one the original is served under its own audio type.
  expect(response.headers()["content-type"]).toMatch(/^audio\/(mp4|flac|mpeg|wav|x-wav)/);

  await activate.click();
  await expect(activate).toHaveCount(0);
  await expect(qualityButton(page)).toContainText("Qualité : Allégée");
  if (!/En lecture\s*:/.test(await page.locator("body").innerText())) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
  }
  await expect(page.locator("body")).toContainText(/En lecture\s*:\s*\S+/);
});

interface OptimizeStatus {
  light: number;
  running: boolean;
  available: boolean;
}

// An admin session in its own context, so the user session of `page` is left alone.
async function optimizeAsAdmin(browser: Browser): Promise<OptimizeStatus | null> {
  const context = await browser.newContext();
  try {
    const admin = await context.newPage();
    await loginAs(admin, "admin@test");
    const headers = { "X-Requested-With": "player" };
    const read = async () =>
      (await (
        await admin.request.get("/api/admin/media/optimize", { headers })
      ).json()) as OptimizeStatus;
    if (!(await read()).available) return null;
    const started = await admin.request.post("/api/admin/media/optimize", { headers });
    expect(started.status()).toBe(202);
    await expect
      .poll(
        async () => {
          const status = await read();
          return status.running === false && status.light >= 1;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    return await read();
  } finally {
    await context.close();
  }
}

test("playback in Allégée gets audio/mp4 once a light variant is ready", async ({
  page,
  browser,
}) => {
  const status = await optimizeAsAdmin(browser);
  test.skip(status === null, "ffmpeg is not available on this machine");

  await openPlayer(page);
  await cycleTo(page, "Allégée");
  const lightResponse = page.waitForResponse(
    (r) => /\/api\/media\/[^?]+\?q=light/.test(r.url()) && r.status() < 400,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Activer le lecteur" })).toBeVisible();
  expect((await lightResponse).headers()["content-type"]).toBe("audio/mp4");
});
