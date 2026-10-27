import { expect, test } from "@playwright/test";
import { loginAs } from "./auth.helpers";

test("opens the built player and its catalogue", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await loginAs(page, "user@test");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Fixture One", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("serves catalogue audio with byte range support behind the session", async ({
  page,
  request,
}) => {
  await loginAs(page, "user@test");
  const catalog = await page.request.get("/api/catalog");
  expect(catalog.status()).toBe(200);
  const { tracks } = (await catalog.json()) as { tracks: { id: string }[] };
  const id = tracks[0].id;

  const response = await page.request.get(`/api/media/${id}`, {
    headers: { Range: "bytes=0-127" },
  });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toMatch(/^audio\//);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-127\/\d+$/);
  expect((await response.body()).byteLength).toBe(128);

  expect((await request.get("/fixture-one.wav")).status()).toBe(404);
  expect((await request.get("/Drops.mp3")).status()).toBe(404);
  expect((await request.get(`/api/media/${id}`)).status()).toBe(401);
});
