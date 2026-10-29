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

// Bounding box of the ink on the page canvas, in device pixels. Text drawn at
// the wrong scale — a font sized in points inside a scaled context, for
// instance — runs past the right margin and shows up here.
async function inkBox(
    page: Page
): Promise<{ left: number; right: number; top: number; scale: number; pageWidth: number } | null> {
    return page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(".page-canvas");
        const context = canvas?.getContext("2d") ?? null;
        if (canvas === undefined || canvas === null || context === null) {
            return null;
        }
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width;
        let right = -1;
        let top = canvas.height;
        for (let y = 0; y < canvas.height; y += 1) {
            for (let x = 0; x < canvas.width; x += 1) {
                if ((pixels[(y * canvas.width + x) * 4] ?? 255) < 200) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                }
            }
        }
        // Read canvas CSS dimensions rather than its client rect: the preview
        // viewport applies a 75% zoom transform, while the expected page
        // margins and canvas backing-store pixels use unzoomed page geometry.
        const pageWidth = Number.parseFloat(canvas.style.width);
        const pageHeight = Number.parseFloat(canvas.style.height);
        const scaleX = canvas.width / pageWidth;
        const scaleY = canvas.height / pageHeight;
        return {
            left: left / scaleX,
            right: right / scaleX,
            top: top / scaleY,
            scale: 1,
            pageWidth
        };
    });
}

test("keeps the painted text inside the margins", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill(
            [
                "A long paragraph that wraps onto several lines, written so that the layout engine has",
                "to break it at the right margin and the canvas has to draw every fragment exactly where",
                "the engine put it, no wider and no narrower, or the fragments start to overlap.",
                "",
                "| Command | Purpose |",
                "| --- | --- |",
                "| npm install | Installs the frontend workspace and the repository tooling. |"
            ].join("\n")
        );
    await expect(page.locator(".page-canvas")).toHaveCount(1);
    await page.waitForTimeout(700);

    const box = await inkBox(page);
    expect(box).not.toBeNull();
    if (box === null) {
        return;
    }
    // A4 at 20mm margins: 56.7pt either side, which is 75.6 device pixels.
    expect(box.left / box.scale).toBeGreaterThanOrEqual(60);
    expect(box.right / box.scale).toBeLessThanOrEqual(box.pageWidth - 60);
    expect(box.top / box.scale).toBeLessThan(200);
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
