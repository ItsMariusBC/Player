import { expect, test } from "@playwright/test";
import songs from "../../music/data.json" with { type: "json" };
import { loginAs } from "./auth.helpers";

test("opens the built player and its catalogue", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await loginAs(page, "user@test");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(songs[0].name, { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// Media stay public for now; increment 2 gates them behind the session.
test("serves catalogue audio with byte range support", async ({ request }) => {
  const response = await request.get(songs[0].url, {
    headers: { Range: "bytes=0-127" },
  });

  expect(response.status()).toBe(206);
  expect(response.headers()["content-type"]).toContain("audio/");
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-127\/\d+$/);
  expect((await response.body()).byteLength).toBe(128);
});
