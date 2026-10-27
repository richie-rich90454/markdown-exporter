import { expect, test, type Page } from "@playwright/test";

async function useSourceEditor(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Source", exact: true }).click();
}

// A first document in the shape of a real README: code, tables, headings.
const FIRST = [
    "# Techtools",
    "",
    "Everything the build produces lands in one place.",
    "",
    "```bash",
    "npm run build",
    "npm start",
    "```",
    "",
    "Then open http://127.0.0.1:8080.",
    "",
    "| Command | Purpose |",
    "| --- | --- |",
    "| npm install | Installs the frontend workspace and the repository tooling. |",
    "| npm run build | Type-checks and bundles the frontend into dist/web. |",
    "| npm start | Runs dist/techtools with data/ and dist/web/. |",
    "",
    "## Configuration",
    "",
    "| Variable | Default |",
    "| --- | --- |",
    "| CATALOG_ADMIN_TOKEN | none; npm start falls back to a placeholder |",
    "| CATALOG_BIND | 127.0.0.1:8080 |",
    "",
    "The server refuses to boot without a token in production."
].join("\n");

// A second document of a different length and structure.
const SECOND = [
    "Converts Markdown to PDF in the browser.",
    "",
    "## Features",
    "",
    "- Live preview with visible page boundaries",
    "",
    "## How to use it",
    "",
    "1. Open the page.",
    "2. Type or paste Markdown into the editor.",
    "",
    "MIT."
].join("\n");

test("replaces a whole document without leaving the previous one behind", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await useSourceEditor(page);
    const editor = page.getByLabel("Markdown editor");

    await editor.fill(FIRST);
    await expect(page.locator(".preview__flow table tr")).toHaveCount(7);
    const firstFrames = await page.locator(".page-frame").count();
    expect(firstFrames).toBeGreaterThan(0);

    await editor.fill(SECOND);
    await expect(page.locator(".preview__flow table tr")).toHaveCount(0);
    await expect(page.locator(".preview__flow li")).toHaveCount(3);

    // The staging holds exactly the document that is on screen: nothing from
    // the previous one, which would otherwise be laid out onto its pages.
    await expect(page.locator(".preview__flow")).not.toContainText("techtools");
    await expect(page.locator(".preview__flow")).not.toContainText("CATALOG_ADMIN_TOKEN");
    await expect(page.locator(".preview__flow")).toContainText("MIT.");

    await expect(page.locator(".page-frame")).toHaveCount(1);
    await expect(page.locator(".page-label").first()).toContainText("Page 1 of 1");
});

test("keeps the second document intact across a settings and theme change", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await useSourceEditor(page);
    const editor = page.getByLabel("Markdown editor");

    await editor.fill(FIRST);
    await expect(page.locator(".preview__flow table tr")).toHaveCount(7);
    await editor.fill(SECOND);
    await expect(page.locator(".preview__flow table tr")).toHaveCount(0);

    await page.getByRole("button", { name: "Page setup" }).click();
    await page
        .getByRole("dialog", { name: "Page setup" })
        .getByLabel("Page size")
        .selectOption("a4");
    await page
        .getByRole("dialog", { name: "Page setup" })
        .getByRole("button", { name: "Close" })
        .click();
    await page.getByRole("button", { name: /^Switch to (dark|light) theme$/ }).click();

    // A settings change repaints from the snapshot, never from the nodes of a
    // document that is no longer on screen.
    await expect(page.locator(".preview__flow")).not.toContainText("techtools");
    await expect(page.locator(".preview__flow")).toContainText("MIT.");
    await expect(page.locator(".page-frame")).toHaveCount(1);
});
