import { expect, test } from "@playwright/test";

test("scrolls through the pages of a long document", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const long = Array.from(
        { length: 90 },
        (_, index) => `Paragraph ${index + 1} with enough words to fill a line of text.`
    ).join("\n\n");
    await page.getByLabel("Markdown editor").fill(long);
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(2);

    const height = await page.evaluate(() => {
        const pane = document.querySelector<HTMLElement>(".pane--preview");
        return pane === null
            ? { scrollHeight: 0, clientHeight: 0 }
            : { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight };
    });
    expect(height.scrollHeight).toBeGreaterThan(height.clientHeight);

    await page.mouse.move(1200, 500);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    const scrolled = await page.evaluate(
        () => document.querySelector<HTMLElement>(".pane--preview")?.scrollTop ?? -1
    );
    expect(scrolled).toBeGreaterThan(0);
});
