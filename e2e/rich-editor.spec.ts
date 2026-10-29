import { expect, test } from "@playwright/test";
import { CONFORMANCE_MARKDOWN } from "../tests/fixtures/markdownConformance";

test("opens in rich mode and edits Markdown through ProseMirror", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Rich", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true"
    );
    const editor = page.getByLabel("Markdown editor");
    await expect(editor).toBeFocused();
    await editor.pressSequentially("A sentence for the manuscript.");
    await expect(page.locator(".preview__flow p")).toHaveText("A sentence for the manuscript.");

    await editor.press("Control+a");
    await page.getByRole("button", { name: "Bold" }).click();
    await expect(editor.locator("strong")).toHaveText("A sentence for the manuscript.");
    await expect(page.locator(".preview__flow strong")).toHaveText(
        "A sentence for the manuscript."
    );

    await editor.press("Control+z");
    await expect(editor.locator("strong")).toHaveCount(0);
});

test("runs the shared Markdown corpus through source mode, rich mode, and preview", async ({
    page
}) => {
    test.setTimeout(30_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const sourceEditor = page.getByLabel("Markdown editor");
    await sourceEditor.fill(CONFORMANCE_MARKDOWN);

    const preview = page.locator(".preview__flow");
    await expect(preview.locator("h1")).toHaveText("Corpus chapter");
    await expect(preview.locator("mark")).toContainText("highlighted");
    await expect(preview.locator(".katex")).not.toHaveCount(0);
    await expect(preview.locator(".markdown-diagram")).toHaveCount(1);
    await expect(preview.locator(".diagram-error code")).toContainText("not a valid diagram");
    await expect(preview).toContainText("Corpus footnote detail.");
    await expect(preview.locator("script")).toHaveCount(0);
    await expect(preview).toContainText("Content after malformed blocks remains visible.");

    await page.getByRole("button", { name: "Rich", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(sourceEditor).toContainText("title: Excluded chapter metadata");
    await expect(sourceEditor).toContainText("\\eqref{eq:corpus}");
    await expect(sourceEditor).toContainText("[^corpus]: Corpus footnote detail.");
    await expect(sourceEditor).toContainText("not a valid diagram !!!");
});

test("keeps opaque author syntax when a supported paragraph is edited in rich mode", async ({
    page
}) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const source = [
        "---",
        "title: A manuscript",
        "author: A. Writer",
        "---",
        "# Chapter one",
        "",
        "A sentence with a footnote.[^source]",
        "",
        "[^source]: A reference that must stay attached.",
        "",
        "::: warning",
        "An author callout that the rich schema does not model.",
        ":::"
    ].join("\n");
    await page.getByLabel("Markdown editor").fill(source);
    await page.getByRole("button", { name: "Rich", exact: true }).click();

    const richEditor = page.getByLabel("Markdown editor");
    await richEditor.press("Control+End");
    await richEditor.pressSequentially(" Added in rich mode.");
    await expect(page.locator(".preview__flow")).toContainText("Added in rich mode.");
    await page.getByRole("button", { name: "Source", exact: true }).click();

    const sourceEditor = page.getByLabel("Markdown editor");
    await expect(sourceEditor).toContainText("title: A manuscript");
    await expect(sourceEditor).toContainText("[^source]: A reference that must stay attached.");
    await expect(sourceEditor).toContainText("::: warning");
    await expect(sourceEditor).toContainText("Added in rich mode.");
});

test("preserves unsupported inline Markdown when neighboring rich text changes", async ({
    page
}) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const sourceEditor = page.getByLabel("Markdown editor");
    await sourceEditor.fill(
        "Read [[field-notes|the field notes]] before continuing<!-- author note -->."
    );
    await page.getByRole("button", { name: "Rich", exact: true }).click();

    const richEditor = page.getByRole("textbox", { name: "Markdown editor" });
    await richEditor.press("Control+Home");
    await richEditor.pressSequentially("Please ");
    await page.getByRole("button", { name: "Source", exact: true }).click();

    const result = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(result).toContainText("Please Read");
    await expect(result).toContainText("[[field-notes|the field notes]]");
    await expect(result).toContainText("<!-- author note -->");
});

test("retains unsupported inline syntax when a paragraph is wholly rewritten", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page
        .getByLabel("Markdown editor")
        .fill("Original prose [[private-page]] with no stable words.");
    await page.getByRole("button", { name: "Rich", exact: true }).click();

    const richEditor = page.getByRole("textbox", { name: "Markdown editor" });
    await richEditor.press("Control+a");
    await richEditor.pressSequentially("Entirely rewritten wording.");
    await page.getByRole("button", { name: "Source", exact: true }).click();

    const result = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(result).toContainText("Entirely [[private-page]] rewritten wording.");
});

test("saves preserved Markdown syntax directly from rich mode", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const sourceEditor = page.getByLabel("Markdown editor");
    await sourceEditor.fill(
        [
            "---",
            "title: A manuscript",
            "---",
            "# Chapter one",
            "",
            "A sentence with a footnote.[^source]",
            "",
            "[^source]: Keep this reference attached.",
            "",
            "::: warning",
            "Keep this author callout.",
            ":::"
        ].join("\n")
    );
    await page.getByRole("button", { name: "Rich", exact: true }).click();
    const richEditor = page.getByRole("textbox", { name: "Markdown editor" });
    await richEditor.press("Control+End");
    await richEditor.pressSequentially(" Added in rich mode.");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const saved = Buffer.concat(chunks).toString("utf8");

    expect(saved).toContain("title: A manuscript");
    expect(saved).toContain("[^source]: Keep this reference attached.");
    expect(saved).toContain("::: warning");
    expect(saved).toContain("Keep this author callout.");
    expect(saved).toContain("Added in rich mode.");
});
