import { expect, test, type Page } from "@playwright/test";

// Counts the dark pixels of a horizontal band of the page canvas. The preview
// paints the same operations the PDF is written from, so a blank band means the
// transform between them is wrong again.
async function bandInk(page: Page, band: number, bands = 4): Promise<number> {
    return page.evaluate(
        ({ band, bands }) => {
            const canvas = document.querySelector<HTMLCanvasElement>(".page-canvas");
            const context = canvas?.getContext("2d") ?? null;
            if (canvas === undefined || canvas === null || context === null) {
                return -1;
            }
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const from = Math.floor((band * canvas.height) / bands);
            const to = Math.floor(((band + 1) * canvas.height) / bands);
            let dark = 0;
            for (let y = from; y < to; y += 1) {
                for (let x = 0; x < canvas.width; x += 2) {
                    if ((pixels[(y * canvas.width + x) * 4] ?? 255) < 200) {
                        dark += 1;
                    }
                }
            }
            return dark;
        },
        { band, bands }
    );
}

test("paints the document onto the page canvas", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill(["# Heading", "", "First paragraph of text.", "", "Second paragraph."].join("\n"));
    await expect(page.locator(".page-canvas")).toHaveCount(1);
    await page.waitForTimeout(600);

    // The first band carries the heading and the first lines; the last band
    // carries the page number in the bottom margin.
    expect(await bandInk(page, 0)).toBeGreaterThan(100);
    expect(await bandInk(page, 3)).toBeGreaterThan(0);
});

test("keeps a table and a code block on the painted page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill(
            [
                "# Notes",
                "",
                "```bash",
                "npm run build",
                "npm start",
                "```",
                "",
                "| Command | Purpose |",
                "| --- | --- |",
                "| npm install | Installs the workspace. |"
            ].join("\n")
        );
    await expect(page.locator(".page-canvas")).toHaveCount(1);
    await page.waitForTimeout(700);

    // The whole document sits in the first band, so ink there means the
    // heading, the code block and the header row all reached the canvas.
    expect(await bandInk(page, 0)).toBeGreaterThan(200);
});
