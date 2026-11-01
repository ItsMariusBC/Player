import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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

/** Imports a fresh WAV and returns its filename and track id (the track is selected in the inbox). */
async function importTrack(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Administration" });
  const filename = `${unique("e2e")}.wav`;
  await dialog.locator("input[type=file][multiple]").setInputFiles({
    name: filename,
    mimeType: "audio/wav",
    buffer: freshWav(),
  });
  const row = dialog.getByRole("listitem").filter({ hasText: filename });
  await expect(row.getByText("Importé")).toBeVisible({ timeout: 15000 });
  await row.getByRole("button", { name: `Voir ${filename}` }).click();
  const selected = dialog.locator("tr[aria-current=true]");
  await expect(selected).toHaveCount(1);
  const id = await selected.getAttribute("data-track-id");
  expect(id).toBeTruthy();
  return { filename, id: id as string };
}

async function closePanel(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Administration" })).toHaveCount(0);
}

test("admin imports a track, files it in a new folder and finds it in the queue", async ({
  page,
}) => {
  const dialog = await openAdmin(page);
  const folder = unique("Test");

  await dialog.getByRole("button", { name: "+ Nouveau dossier" }).click();
  await dialog.getByRole("textbox", { name: "Nom du nouveau dossier" }).fill(folder);
  await page.keyboard.press("Enter");
  const folderRow = dialog
    .getByRole("navigation", { name: "Dossiers" })
    .getByRole("button", { name: folder });
  await expect(folderRow).toBeVisible();
  // Imports land in the selected folder: go back to the inbox so the track is filed by hand below.
  await dialog
    .getByRole("navigation", { name: "Dossiers" })
    .getByRole("button", { name: /^Boîte d'arrivée/ })
    .click();

  const { id } = await importTrack(page);
  const row = dialog.locator(`tr[data-track-id="${id}"]`);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Déplacer vers/ }).hover();
  await page.getByRole("menuitem", { name: folder }).click();
  await expect(row).toHaveCount(0);

  await folderRow.click();
  await expect(dialog.locator(`tr[data-track-id="${id}"]`)).toBeVisible();
  const label = await dialog
    .locator(`tr[data-track-id="${id}"]`)
    .getByRole("checkbox")
    .getAttribute("aria-label");
  const title = (label ?? "").replace(/^Sélectionner /, "");

  await closePanel(page);
  const queueFolder = page.getByRole("button", { name: new RegExp(`^${folder}`) });
  await expect(queueFolder).toBeVisible();
  if ((await queueFolder.getAttribute("aria-expanded")) !== "true") await queueFolder.click();
  await expect(queueFolder).toHaveAttribute("aria-expanded", "true");
  const plainTitle = title.split("\n")[0].trim();
  expect(plainTitle).not.toBe("");
  await expect(page.getByRole("button", { name: plainTitle }).first()).toBeVisible();
});

test("admin renames a track with the editor", async ({ page }) => {
  const dialog = await openAdmin(page);
  const { id } = await importTrack(page);
  const newTitle = unique("Renamed");

  await dialog.getByLabel("Titre", { exact: true }).fill(newTitle);
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog.locator(`tr[data-track-id="${id}"]`)).toContainText(newTitle);

  await closePanel(page);
  await expect(page.getByRole("button", { name: new RegExp(newTitle) }).first()).toBeVisible();
});

test("admin deletes a track after confirming", async ({ page }) => {
  const dialog = await openAdmin(page);
  const { id } = await importTrack(page);

  const mediaBefore = await page.request.get(`/api/media/${id}`);
  expect(mediaBefore.status()).toBe(200);

  await dialog.locator(`tr[data-track-id="${id}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await page.getByRole("menuitem", { name: "Oui" }).click();
  await expect(dialog.locator(`tr[data-track-id="${id}"]`)).toHaveCount(0);

  await expect.poll(async () => (await page.request.get(`/api/media/${id}`)).status()).toBe(404);
});

test("user cannot reach the admin API nor the admin button", async ({ page }) => {
  await loginAs(page, "user@test");

  const response = await page.request.get("/api/admin/folders");
  expect(response.status()).toBe(403);
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Administration" })).toHaveCount(0);
});

test("admin reorders folders and nests one by drag and drop", async ({ page }) => {
  const dialog = await openAdmin(page);
  const tree = dialog.getByRole("navigation", { name: "Dossiers" });
  const names = [unique("A"), unique("B"), unique("C")];
  for (const name of names) {
    // Creating selects the new folder: go back to the inbox so each one lands at the root.
    await tree.getByRole("button", { name: "Boîte d'arrivée" }).click();
    await dialog.getByRole("button", { name: "+ Nouveau dossier" }).click();
    await dialog.getByRole("textbox", { name: "Nom du nouveau dossier" }).fill(name);
    await page.keyboard.press("Enter");
    await expect(tree.getByRole("button", { name })).toBeVisible();
  }
  const row = (name: string) => tree.getByRole("button", { name });
  const rootOrder = async () => {
    const response = await page.request.get("/api/admin/folders");
    const { folders } = (await response.json()) as {
      folders: { name: string; children: { name: string }[] }[];
    };
    return folders;
  };

  // Drop C on the top edge of A: C moves before A.
  const aBox = await row(names[0]).boundingBox();
  if (!aBox) throw new Error("Row A has no box");
  await row(names[2]).hover();
  await page.mouse.down();
  await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + 2, { steps: 5 });
  await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + 3, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await rootOrder()).map((f) => f.name).filter((n) => names.includes(n)))
    .toEqual([names[2], names[0], names[1]]);

  // Drop B in the middle of A: B becomes a child of A.
  await row(names[1]).dragTo(row(names[0]));
  await expect
    .poll(async () =>
      (await rootOrder()).find((f) => f.name === names[0])?.children.map((c) => c.name),
    )
    .toEqual([names[1]]);
  await closePanel(page);
});
