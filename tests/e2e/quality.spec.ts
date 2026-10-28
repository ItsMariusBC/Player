import { expect, test, type Page } from "@playwright/test";
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
  const lightRequest = page.waitForRequest(/\/api\/media\/[^?]+\?q=light/);
  await page.reload();
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  await expect(activate).toBeVisible();
  const response = await (await lightRequest).response();
  expect([200, 206]).toContain(response?.status());

  await activate.click();
  await expect(activate).toHaveCount(0);
  await expect(qualityButton(page)).toContainText("Qualité : Allégée");
  if (!/En lecture\s*:/.test(await page.locator("body").innerText())) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
  }
  await expect(page.locator("body")).toContainText(/En lecture\s*:\s*\S+/);
});
