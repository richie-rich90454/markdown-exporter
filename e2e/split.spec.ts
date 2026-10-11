import { expect, test } from "@playwright/test";

test("oversized blocks split across pages and survive editing", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const quote = Array.from(
        { length: 80 },
        (_, index) => `> Quote line ${index + 1} carries the tall block.`
    ).join("\n>\n");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(`Intro paragraph.\n\n${quote}\n\nAfter the quote.`);
    await expect(page.locator(".preview__flow blockquote p")).toHaveCount(80);

    // The blockquote is taller than one page, so it flows onto several pages
    // instead of being clipped at the page edge.
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(1);
    await expect(page.locator(".page-canvas").last()).toBeVisible();

    // Editing keeps the whole quote mounted: the pagination is derived from the
    // rendered nodes, never by moving them apart.
    await editor.click();
    await editor.press("End");
    await editor.pressSequentially("\n\nTyped after the split.");
    await expect(page.locator(".preview__flow blockquote p")).toHaveCount(80);
    await expect(page.locator(".preview__flow")).toContainText("Typed after the split.");
    await expect(page.locator(".preview__flow blockquote p").last()).toHaveText(
        "Quote line 80 carries the tall block."
    );
});
