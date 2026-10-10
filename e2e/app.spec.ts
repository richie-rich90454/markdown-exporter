import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);

const SAMPLE = [
    "# Release notes",
    "",
    "The exporter converts Markdown to PDF inside the browser.",
    "",
    "- live preview",
    "- page setup",
    "- no upload",
    "",
    "| Feature | State |",
    "| - | - |",
    "| Pagination | Shipped |",
    "",
    "```js",
    "const size = page.clientHeight;",
    "```",
    "",
    "> Local only."
].join("\n");

async function load(page: Page): Promise<void> {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await expect(editor).toBeFocused();
    await editor.fill(SAMPLE);
    await expect(page.locator(".preview__flow h1")).toHaveText("Release notes");
}

test("renders the document into paged previews", async ({ page }) => {
    await load(page);

    await expect(page.locator(".page-frame")).not.toHaveCount(0);
    await expect(page.locator(".preview__flow table th")).toHaveCount(2);
    await expect(page.locator(".preview__flow li")).toHaveCount(3);
    await expect(page.locator(".page-label").first()).toContainText("Page 1 of");

    const status = page.locator(".statusbar");
    await expect(status).toContainText("Local only");
    await expect(status).toContainText("Pages");
    await expect(status).toContainText("Render");
});

test("shows the empty state before anything is typed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".preview__placeholder")).toHaveText(
        "Your document will appear here."
    );
    await expect(page.locator(".page-frame")).toHaveCount(1);
});

test("opens the shortcut overlay and closes it with Escape", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+/");
    const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("Export");
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
});

test("resizes the split with the keyboard", async ({ page }) => {
    await page.goto("/");
    const divider = page.getByRole("separator");
    await divider.focus();
    const before = await divider.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect(divider).not.toHaveAttribute("aria-valuenow", before ?? "50");
    await page.keyboard.press("Enter");
    await expect(divider).toHaveAttribute("aria-valuenow", "50");
});

test("applies page setup changes to the preview and print", async ({ page }) => {
    await load(page);
    const frame = page.locator(".page-frame").first();
    const heightOf = async (): Promise<number> =>
        Math.round(
            await frame.evaluate((element) => Number.parseFloat(getComputedStyle(element).height))
        );
    expect(await heightOf()).toBe(1123);

    await page.getByRole("button", { name: "Page setup" }).click();
    const sheet = page.getByRole("dialog", { name: "Page setup" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Page size").selectOption("letter");
    expect(await heightOf()).toBe(1056);

    await sheet.getByLabel("Margins").selectOption("30");
    await expect
        .poll(async () =>
            page.locator("#page-rule").evaluate((element) => element.textContent ?? "")
        )
        .toContain("margin: 30mm");

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
});

test("exports HTML through the format menu", async ({ page }) => {
    await load(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Choose export format" }).click();
    await page.getByRole("menuitem", { name: "HTML" }).click();

    const file = await download;
    expect(file.suggestedFilename()).toBe("release-notes.html");
    await expect(page.locator(".statusbar")).toContainText("Saved HTML");
});

test("navigates between pages with the keyboard", async ({ page }) => {
    await page.goto("/");
    const long = Array.from(
        { length: 90 },
        (_, index) => `Paragraph ${index + 1} with a few words.`
    ).join("\n\n");
    await page.getByLabel("Markdown editor").fill(long);
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(1);

    // The rendered content sits in front of the page frames, so the click is
    // dispatched through it and resolved to a page by the preview itself.
    await page.locator(".page-frame").first().click({ force: true });
    await expect(page.locator(".page-frame").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('.page-frame[data-page-index="1"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Markdown editor")).toBeFocused();
});

test("breaks content across pages at block boundaries", async ({ page }) => {
    await page.goto("/");
    const long = Array.from(
        { length: 90 },
        (_, index) => `## Heading ${index + 1}\n\nBody text.`
    ).join("\n\n");
    await page.getByLabel("Markdown editor").fill(long);
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(1);

    const pages = await page.locator(".page-frame").evaluateAll((frames) =>
        frames.map((frame) => ({
            top: Number.parseFloat(getComputedStyle(frame).top),
            height: Number.parseFloat(getComputedStyle(frame).height)
        }))
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(Math.round(pages[0]?.height ?? 0)).toBe(1123);
    // Every page starts one page height plus the 24px gutter below the previous.
    for (let index = 1; index < pages.length; index += 1) {
        expect(Math.round((pages[index]?.top ?? 0) - (pages[index - 1]?.top ?? 0))).toBe(1147);
    }

    // No block is split: every spacer sits between paragraphs, never inside one.
    await expect(page.locator(".page-spacer")).toHaveCount(pages.length - 1);
    await expect(page.locator(".page-label").last()).toContainText(
        `Page ${pages.length} of ${pages.length}`
    );
});

test("stacks the panes below 900px and toggles between them", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    await page.goto("/");
    await expect(page.locator(".app--stacked")).toHaveCount(1);
    await expect(page.locator(".pane--editor")).toBeVisible();
    await expect(page.locator(".pane--preview")).toBeHidden();
    await expect(page.locator(".divider")).toBeHidden();

    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator(".pane--editor")).toBeHidden();
    await expect(page.locator(".pane--preview")).toBeVisible();
});

test("passes an automated accessibility scan", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const violations = await scan(page);
        expect(violations, `contrast in ${colorScheme} mode`).toEqual([]);
    }
});

async function scan(page: Page): Promise<string[]> {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(SAMPLE);
    await expect(page.locator(".preview__flow h1")).toHaveText("Release notes");
    await page.addScriptTag({ path: require.resolve("axe-core") });
    return page.evaluate(async () => {
        const axe = (
            window as unknown as {
                axe: { run: () => Promise<{ violations: Array<{ id: string }> }> };
            }
        ).axe;
        const result = await axe.run();
        return result.violations.map((violation) => violation.id);
    });
}
