import { expect, test } from "@playwright/test";
import songs from "../../music/data.json" with { type: "json" };
import { loginAs, logoutViaButton } from "./auth.helpers";

test("user sees the player and the logout button", async ({ page }) => {
  await loginAs(page, "user@test");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(songs[0].name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("admin session reports the admin role", async ({ page }) => {
  await loginAs(page, "admin@test");

  const response = await page.request.get("/api/session");
  expect(response.status()).toBe(200);
  expect((await response.json()).role).toBe("admin");
});

test("account without access gets the denied screen", async ({ page }) => {
  await loginAs(page, "nobody@test");

  await expect(page.getByText("Accès refusé")).toBeVisible();
  await expect(page.locator('button[aria-label="Agrandir le visualiseur"]')).toHaveCount(0);
});

test("logout ends the server session", async ({ page }) => {
  await loginAs(page, "user@test");
  await logoutViaButton(page);

  const response = await page.request.get("/api/session");
  expect(response.status()).toBe(401);
});

test("anonymous visitors are sent to the provider", async ({ page }) => {
  const response = await page.request.get("/api/session");
  expect(response.status()).toBe(401);

  await page.goto("/");
  await page.waitForURL(/\/interaction\//);
});
