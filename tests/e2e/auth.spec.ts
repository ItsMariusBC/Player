import { expect, test } from "@playwright/test";
import { loginAs, logoutViaButton } from "./auth.helpers";

test("user sees the player and the logout button", async ({ page }) => {
  await loginAs(page, "user@test");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Fixture One", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("admin session reports the admin role", async ({ page }) => {
  await loginAs(page, "admin@test");

  const response = await page.request.get("/api/session");
  expect(response.status()).toBe(200);
  expect((await response.json()).role).toBe("admin");
});

test("admin opens the empty admin panel and closes it with Escape", async ({ page }) => {
  await loginAs(page, "admin@test");

  const expand = page.locator('button[aria-label="Agrandir le visualiseur"]');
  await expect(expand).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administration" })).toBeVisible();

  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  if (await activate.isVisible()) await activate.click();
  await page.getByRole("button", { name: "Administration" }).click();

  const dialog = page.getByRole("dialog", { name: "Administration" });
  await expect(dialog).toBeVisible();
  await expect(expand).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Se déconnecter" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeVisible();
});

test("user does not get the admin button", async ({ page }) => {
  await loginAs(page, "user@test");

  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administration" })).toHaveCount(0);
});

test("account without access gets the denied screen", async ({ page }) => {
  await loginAs(page, "nobody@test");

  await expect(page.getByText("Accès refusé")).toBeVisible();
  await expect(page.getByText("Nobody Test")).toBeVisible();
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
