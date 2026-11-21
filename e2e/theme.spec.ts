import { expect, test } from "@playwright/test";

test.describe("theme before hydration", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/_next/static/**", (route) =>
      route.request().resourceType() === "script"
        ? route.abort()
        : route.continue(),
    );
  });

  test("a returning viewer sees cyber with the application scripts blocked", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("syncwatch-theme", "cyber"),
    );
    await page.goto("/");

    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(5, 5, 5)",
    );
  });

  test("a first-time viewer sees cotton with the application scripts blocked", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 240, 245)",
    );
  });
});

test("theme switching survives hydration and reloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|server rendered html/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });

  const body = page.locator("body");
  const toggle = page.getByRole("button", { name: "Toggle Theme" });
  await page.goto("/");
  await expect(body).toHaveCSS("background-color", "rgb(255, 240, 245)");
  await toggle.click();
  await expect(body).toHaveCSS("background-color", "rgb(5, 5, 5)");

  await page.reload();
  await expect(body).toHaveCSS("background-color", "rgb(5, 5, 5)");
  await toggle.click();
  await expect(body).toHaveCSS("background-color", "rgb(255, 240, 245)");

  await page.reload();
  await expect(body).toHaveCSS("background-color", "rgb(255, 240, 245)");
  expect(errors).toEqual([]);
});
