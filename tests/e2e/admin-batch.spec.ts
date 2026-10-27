import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAs } from "./auth.helpers";

// A valid 44-byte-header PCM WAV (mono, 8 kHz, 16 bit) with random samples, so each call has
// its own content hash and never collides with the seeded fixtures or another test.
function freshWav(): Buffer {
  const samples = 800;
  const data = randomBytes(samples * 2);
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

async function openAdmin(page: Page) {
  await loginAs(page, "admin@test");
  const activate = page.getByRole("button", { name: "Activer le lecteur" });
  const adminButton = page.getByRole("button", { name: "Administration" });
  await expect(activate.or(adminButton).first()).toBeVisible();
  if (await activate.isVisible()) await activate.click();
  await expect(activate).toHaveCount(0);
  await adminButton.click();
  const dialog = page.getByRole("dialog", { name: "Administration" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closePanel(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Administration" })).toHaveCount(0);
}

// Created by the scenarios, removed afterwards even when an assertion failed.
const createdTrackIds: string[] = [];
const createdFolders: string[] = [];
const tempDirs: string[] = [];

test.afterEach(async ({ browser }) => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  const trackIds = createdTrackIds.splice(0);
  const folderNames = createdFolders.splice(0);
  if (trackIds.length === 0 && folderNames.length === 0) return;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginAs(page, "admin@test");
    const headers = { "X-Requested-With": "player" };
    if (trackIds.length > 0) {
      await page.request.post("/api/admin/tracks/batch-delete", {
        headers,
        data: { ids: trackIds },
      });
    }
    if (folderNames.length > 0) {
      type Node = { id: string; name: string; children?: Node[] };
      const listed = await page.request.get("/api/admin/folders", { headers });
      if (!listed.ok()) return;
      const { folders } = (await listed.json()) as { folders: Node[] };
      const matches: Node[] = [];
      const walk = (nodes: Node[]) => {
        for (const node of nodes) {
          if (folderNames.includes(node.name)) matches.push(node);
          walk(node.children ?? []);
        }
      };
      walk(folders);
      for (const node of matches) {
        await page.request.delete(`/api/admin/folders/${encodeURIComponent(node.id)}?force=1`, {
          headers,
        });
      }
    }
  } finally {
    await context.close();
  }
});

async function createFolder(page: Page, dialog: Locator, name: string) {
  createdFolders.push(name);
  await dialog.getByRole("button", { name: "+ Nouveau dossier" }).click();
  await dialog.getByRole("textbox", { name: "Nom du nouveau dossier" }).fill(name);
  await page.keyboard.press("Enter");
  const row = dialog.getByRole("navigation", { name: "Dossiers" }).getByRole("button", { name });
  await expect(row).toBeVisible();
  return row;
}

/** Imports a fresh WAV into the inbox; returns the track id and its displayed title. */
async function importTrack(dialog: Locator) {
  const filename = `${unique("e2e")}.wav`;
  await dialog
    .locator("input[type=file][multiple]")
    .setInputFiles({ name: filename, mimeType: "audio/wav", buffer: freshWav() });
  const item = dialog.getByRole("listitem").filter({ hasText: filename });
  await expect(item.getByText("Importé")).toBeVisible({ timeout: 15000 });
  await item.getByRole("button", { name: `Voir ${filename}` }).click();
  const selected = dialog.locator("tr[aria-current=true]");
  await expect(selected).toHaveCount(1);
  const id = (await selected.getAttribute("data-track-id")) as string;
  expect(id).toBeTruthy();
  createdTrackIds.push(id);
  const label = (await selected.getByRole("checkbox").getAttribute("aria-label")) ?? "";
  const title = label.replace(/^Sélectionner /, "");
  expect(title).not.toBe("");
  return { id, title };
}

async function importTwo(dialog: Locator) {
  const first = await importTrack(dialog);
  const second = await importTrack(dialog);
  for (const track of [first, second]) {
    await dialog.getByRole("checkbox", { name: `Sélectionner ${track.title}` }).check();
  }
  await expect(dialog.getByRole("toolbar", { name: "Actions sur la sélection" })).toBeVisible();
  return [first, second];
}

test("admin moves two selected tracks into a folder", async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openAdmin(page);
  const folder = unique("Lot");
  await createFolder(page, dialog, folder);
  // A new folder gets selected and imports land in the selected folder: go back to the inbox.
  await dialog
    .getByRole("navigation", { name: "Dossiers" })
    .getByRole("button", { name: /^Boîte d'arrivée/ })
    .click();
  const tracks = await importTwo(dialog);

  await dialog.getByLabel("Déplacer vers…").selectOption({ label: folder });
  for (const track of tracks) {
    await expect(dialog.locator(`tr[data-track-id="${track.id}"]`)).toHaveCount(0);
  }

  await closePanel(page);
  const queueFolder = page.getByRole("button", { name: new RegExp(`^${folder}`) });
  await expect(queueFolder).toBeVisible();
  if ((await queueFolder.getAttribute("aria-expanded")) !== "true") await queueFolder.click();
  await expect(queueFolder).toHaveAttribute("aria-expanded", "true");
  for (const track of tracks) {
    await expect(page.getByRole("button", { name: track.title }).first()).toBeVisible();
  }
});

test("admin sets the artist of two selected tracks", async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openAdmin(page);
  const tracks = await importTwo(dialog);
  const artist = unique("Artiste");

  const toolbar = dialog.getByRole("toolbar", { name: "Actions sur la sélection" });
  await toolbar.getByRole("button", { name: "Artiste…" }).click();
  await toolbar.getByRole("textbox", { name: "Artiste", exact: true }).fill(artist);
  await toolbar.getByRole("button", { name: "Appliquer" }).click();
  for (const track of tracks) {
    await expect(dialog.locator(`tr[data-track-id="${track.id}"]`)).toContainText(artist);
  }
});

test("admin deletes two selected tracks after confirming", async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openAdmin(page);
  const tracks = await importTwo(dialog);
  for (const track of tracks) {
    expect((await page.request.get(`/api/media/${track.id}`)).status()).toBe(200);
  }

  const toolbar = dialog.getByRole("toolbar", { name: "Actions sur la sélection" });
  await toolbar.getByRole("button", { name: "Supprimer" }).click();
  await expect(toolbar.getByText("Supprimer 2 titres ?")).toBeVisible();
  await toolbar.getByRole("button", { name: "Oui" }).click();
  for (const track of tracks) {
    await expect(dialog.locator(`tr[data-track-id="${track.id}"]`)).toHaveCount(0);
    await expect
      .poll(async () => (await page.request.get(`/api/media/${track.id}`)).status())
      .toBe(404);
  }
});

test("admin imports a directory and gets a folder holding its track", async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openAdmin(page);

  const root = mkdtempSync(join(tmpdir(), "player-e2e-"));
  tempDirs.push(root);
  const album = unique("Album");
  mkdirSync(join(root, album), { recursive: true });
  writeFileSync(join(root, album, "un.wav"), freshWav());
  createdFolders.push(album);

  await dialog.locator("input[type=file][webkitdirectory]").setInputFiles(root);

  const tree = dialog.getByRole("navigation", { name: "Dossiers" });
  const albumRow = tree.getByRole("button", { name: album });
  await expect(albumRow).toBeVisible({ timeout: 20000 });
  await albumRow.click();
  const rows = dialog.locator("tr[data-track-id]");
  await expect(rows).toHaveCount(1, { timeout: 20000 });
  const id = await rows.first().getAttribute("data-track-id");
  if (id) createdTrackIds.push(id);
  await expect(rows.first()).toContainText("un");
});
