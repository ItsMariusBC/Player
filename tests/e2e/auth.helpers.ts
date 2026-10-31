import { expect, type Page } from "@playwright/test";

export type Account = "admin@test" | "user@test" | "nobody@test";

const appOrigin = new URL(process.env.PLAYER_TEST_URL || "http://127.0.0.1:4173").origin;

export async function loginAs(page: Page, account: Account): Promise<void> {
  await page.goto("/");
  // toHaveURL polls: waitForURL throws ERR_ABORTED when the redirect chain aborts a navigation.
  await expect(page).toHaveURL(/\/interaction\//);
  await page.locator("input[name=login]").fill(account);
  await page.locator("input[name=password]").fill("password");
  await page.locator("button[type=submit]").click();
  await page.getByText("Authorize").waitFor();
  await page.locator("button[type=submit]").click();
  await page.waitForURL((url) => url.origin === appOrigin);
}

export async function logoutViaButton(page: Page): Promise<void> {
  // The audio-activation overlay covers the page until the first interaction.
  const logout = page.getByRole("button", { name: "Se déconnecter" });
  await expect(logout).toBeVisible();
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  if (await activate.isVisible()) await activate.click();
  await logout.click();
  // Leaves the app for the provider's end_session, which may bounce back and re-login.
  await page.waitForURL((url) => url.origin !== appOrigin);
}
