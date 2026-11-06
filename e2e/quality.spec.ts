import { expect, test } from "@playwright/test";

test("keeps display math centered after keyboard entry in the rich editor", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.pressSequentially(
        "A displayed equation:\n\n$$\na\\cdot b = \\sum_{i=1}^{n} a_i b_i\n$$"
    );

    const previewMath = page.locator(".page-math-overlay .katex-html");
    await expect(previewMath).toHaveCount(1, { timeout: 15_000 });
    const geometry = await previewMath.evaluate((element) => {
        const page = element.closest<HTMLElement>(".page-frame");
        if (page === null) return null;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let left = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let node = walker.nextNode();
        while (node !== null) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) {
                if (rect.width <= 0 || rect.height <= 0) continue;
                left = Math.min(left, rect.left);
                right = Math.max(right, rect.right);
            }
            node = walker.nextNode();
        }
        const bounds = page.getBoundingClientRect();
        return {
            visibleCenter: (left + right) / 2,
            pageCenter: bounds.left + bounds.width / 2
        };
    });

    expect(geometry).not.toBeNull();
    expect(Math.abs((geometry?.visibleCenter ?? 0) - (geometry?.pageCenter ?? 0))).toBeLessThan(2);
});

test("keeps the mobile writing workspace inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toBeVisible();
    const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    await expect(page.getByRole("button", { name: "Open file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Focus mode" })).toBeVisible();
});

test("keeps an empty preview page paper-white in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    const paper = page.locator(".page-frame").first();
    await expect(paper).toBeVisible();
    await expect
        .poll(() => paper.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe("rgb(255, 255, 255)");
});

test("shows a writing cue in the empty rich editor", async ({ page }) => {
    await page.goto("/");

    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toHaveAttribute("aria-placeholder", /Start writing/);
    const placeholder = await editor.evaluate((element) => {
        return getComputedStyle(element, "::before").content;
    });
    expect(placeholder).toContain("Start writing");
});

test("uses sentence case for editor and status labels", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".editor-toolbar__label")).toHaveText("Edit");
    await expect(page.locator(".statusbar__label")).toHaveText([
        "Chars",
        "Words",
        "Pages",
        "Render"
    ]);
    const transforms = await page
        .locator(".editor-toolbar__label, .statusbar__label, .field__label")
        .evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).textTransform)
        );
    expect(transforms).not.toContain("uppercase");
});
