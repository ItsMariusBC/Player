import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth.helpers";

// A valid PCM WAV (mono, 8 kHz, 16 bit) with random samples: its content hash is never shared.
function freshWav(): Buffer {
  const data = randomBytes(800 * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

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
    // Tracks imported from a request carry the requested title.
    const catalog = await page.request.get("/api/catalog");
    if (!catalog.ok()) return;
    const { tracks } = (await catalog.json()) as { tracks: { id: string; title: string }[] };
    for (const track of tracks.filter((item) => titles.includes(item.title))) {
      await page.request.delete(`/api/admin/tracks/${encodeURIComponent(track.id)}`, { headers });
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
  await expect(row.getByText("Acceptée")).toBeVisible();

  // The user sees it accepted.
  await page.reload();
  dialog = await openRequestDialog(page);
  mine = dialog.getByRole("listitem").filter({ hasText: title });
  await expect(mine.getByText("Acceptée")).toBeVisible();

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

async function sendRequest(page: Page, title: string) {
  const dialog = await openRequestDialog(page);
  await dialog.getByRole("searchbox", { name: "Recherche" }).fill(title);
  await dialog.getByRole("button", { name: "Demander", exact: true }).click();
  await expect(dialog.getByText("Demande envoyée")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("an imported request becomes a track the user can play", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const title = unique("Import");
  createdTitles.push(title);

  await loginAs(page, "user@test");
  await sendRequest(page, title);

  const adminContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    const adminDialog = await openAdminRequests(adminPage);
    const row = adminDialog.locator("[data-request-id]").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Importer" }).click();
    await adminPage.locator("input[data-request-import-input]").setInputFiles({
      name: `${unique("e2e")}.wav`,
      mimeType: "audio/wav",
      buffer: freshWav(),
    });

    // The panel switches to the catalogue tab while the import runs; come back to watch the row.
    await adminDialog.getByRole("tab", { name: /^Demandes/ }).click();
    await expect
      .poll(
        async () => {
          const text = await adminDialog
            .locator("[data-request-id]")
            .filter({ hasText: title })
            .textContent();
          return text?.includes("Ajoutée") ?? false;
        },
        { timeout: 45_000 },
      )
      .toBe(true);

    await row.getByRole("button", { name: "Voir le titre" }).click();
    await expect(adminDialog.getByRole("tab", { name: "Catalogue" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(adminDialog.getByLabel("Titre", { exact: true })).toHaveValue(title);
  } finally {
    await adminContext.close();
  }

  // A fresh user context sees the badge, the new status and can play the track.
  const userContext = await browser.newContext();
  try {
    const userPage = await userContext.newPage();
    await loginAs(userPage, "user@test");
    await activatePlayer(userPage);
    const badge = userPage.getByRole("button", { name: /Demander un son.*nouveauté/ });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Demander un son \(\d+\)/);
    await expect(badge).toHaveAttribute("aria-label", /nouveauté/);
    await badge.click();
    const dialog = userPage.getByRole("dialog", { name: "Demander un son" });
    await expect(dialog).toBeVisible();
    const mine = dialog.getByRole("listitem").filter({ hasText: title });
    await expect(mine.getByText("Ajoutée")).toBeVisible();
    await mine.getByRole("button", { name: "Écouter" }).click();
    await expect(userPage.getByText(`En lecture : ${title}`)).toBeVisible({ timeout: 15_000 });
  } finally {
    await userContext.close();
  }
});

test("a rejected request shows its reason to the user", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const title = unique("Refus");
  createdTitles.push(title);

  await loginAs(page, "user@test");
  await sendRequest(page, title);

  const adminContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    const adminDialog = await openAdminRequests(adminPage);
    const row = adminDialog.locator("[data-request-id]").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Refuser" }).click();
    await row.getByRole("textbox", { name: "Motif (facultatif)" }).fill("Hors catalogue");
    await row.getByRole("button", { name: "Confirmer" }).click();
    await expect(row.getByText("Refusée")).toBeVisible();
  } finally {
    await adminContext.close();
  }

  await page.reload();
  const dialog = await openRequestDialog(page);
  const mine = dialog.getByRole("listitem").filter({ hasText: title });
  await expect(mine.getByText("Refusée : Hors catalogue")).toBeVisible();
});
