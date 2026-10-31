import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth.helpers";

const unique = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

async function activatePlayer(page: Page) {
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  const requestButton = page.getByRole("button", { name: "Demander un son" });
  await expect(activate.or(requestButton).first()).toBeVisible();
  if (await activate.isVisible()) await activate.click();
  await expect(activate).toHaveCount(0);
}

async function openRequestDialog(page: Page) {
  await activatePlayer(page);
  await page.getByRole("button", { name: "Demander un son" }).click();
  const dialog = page.getByRole("dialog", { name: "Demander un son" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openAdminRequests(page: Page) {
  await loginAs(page, "admin@test");
  await activatePlayer(page);
  await page.getByRole("button", { name: "Administration" }).click();
  const dialog = page.getByRole("dialog", { name: "Administration" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: /^Demandes/ }).click();
  return dialog;
}

// Titles created by the scenarios, deleted afterwards even when an assertion failed.
const createdTitles: string[] = [];

test.afterEach(async ({ browser }) => {
  const titles = createdTitles.splice(0);
  if (titles.length === 0) return;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginAs(page, "admin@test");
    const headers = { "X-Requested-With": "player" };
    const listed = await page.request.get("/api/admin/requests", { headers });
    if (!listed.ok()) return;
    const { requests } = (await listed.json()) as { requests: { id: string; title: string }[] };
    for (const request of requests.filter((item) => titles.includes(item.title))) {
      await page.request.delete(`/api/admin/requests/${encodeURIComponent(request.id)}`, {
        headers,
      });
    }
  } finally {
    await context.close();
  }
});

test("a user requests a song, the admin accepts then deletes it", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const title = unique("Demande");
  createdTitles.push(title);

  // The user types a title and sends it as is (no network: « Demander », not « Rechercher »).
  await loginAs(page, "user@test");
  let dialog = await openRequestDialog(page);
  await dialog.getByRole("searchbox", { name: "Recherche" }).fill(title);
  await dialog.getByRole("button", { name: "Demander", exact: true }).click();
  await expect(dialog.getByText("Demande envoyée")).toBeVisible();
  let mine = dialog.getByRole("listitem").filter({ hasText: title });
  await expect(mine).toBeVisible();
  await expect(mine.getByText("En attente")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Demander un son" })).toBeVisible();

  // The admin accepts it.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminDialog = await openAdminRequests(adminPage);
  const row = adminDialog.locator("[data-request-id]").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(row.getByText("Validée")).toBeVisible();

  // The user sees it accepted.
  await page.reload();
  dialog = await openRequestDialog(page);
  mine = dialog.getByRole("listitem").filter({ hasText: title });
  await expect(mine.getByText("Validée")).toBeVisible();

  // The admin deletes it.
  await row.getByRole("button", { name: "Supprimer" }).click();
  await row.getByRole("button", { name: "Oui" }).click();
  await expect(row).toHaveCount(0);
  await adminContext.close();

  const response = await page.request.get("/api/requests", {
    headers: { "X-Requested-With": "player" },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { requests: { title: string }[] };
  expect(body.requests.map((request) => request.title)).not.toContain(title);
});

test("a regular user cannot list the admin requests", async ({ page }) => {
  await loginAs(page, "user@test");
  const response = await page.request.get("/api/admin/requests", {
    headers: { "X-Requested-With": "player" },
  });
  expect(response.status()).toBe(403);
});
