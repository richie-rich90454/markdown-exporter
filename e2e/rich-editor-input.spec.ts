import { expect, test } from "@playwright/test";

test("keeps selection-aware keyboard formatting in the rich editor", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toBeFocused();
    const sentence = "A sentence for the manuscript.";
    await editor.pressSequentially(sentence);
    await editor.press("Control+a");
    await expect
        .poll(() => editor.evaluate(() => window.getSelection()?.toString() ?? ""))
        .toContain(sentence);
    await editor.press("Control+b");

    await expect(editor.locator("strong")).toHaveText(sentence);
    await expect(page.locator(".preview__flow strong")).toHaveText(sentence);
});

test("activates selection formatting from the keyboard-accessible toolbar", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    const sentence = "A keyboard-formatted sentence.";
    await editor.pressSequentially(sentence);
    await editor.press("Control+a");
    await expect
        .poll(() => editor.evaluate(() => window.getSelection()?.toString() ?? ""))
        .toContain(sentence);

    const bold = page.getByRole("button", { name: "Bold" });
    await bold.focus();
    await page.keyboard.press("Enter");

    await expect(editor.locator("strong")).toHaveText(sentence);
    await expect(page.locator(".preview__flow strong")).toHaveText(sentence);
});

test("pastes Markdown blocks through the rich editor clipboard path", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.focus();
    const paste = await editor.evaluate((element, source) => {
        const clipboard = new DataTransfer();
        clipboard.setData("text/plain", source);
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { configurable: true, value: clipboard });
        element.dispatchEvent(event);
        return {
            defaultPrevented: event.defaultPrevented,
            clipboardText: event.clipboardData?.getData("text/plain") ?? ""
        };
    }, "## Clipboard heading\n\nPasted **bold** text.");
    expect(paste).toEqual({
        defaultPrevented: true,
        clipboardText: "## Clipboard heading\n\nPasted **bold** text."
    });

    await expect(editor.locator("h2")).toHaveCount(1);
    await expect(editor.locator("strong")).toHaveCount(1);
    await expect(editor.locator("h2")).toHaveText("Clipboard heading");
    await expect(editor.locator("strong")).toHaveText("bold");
    await expect(page.locator(".preview__flow h2")).toHaveCount(1);
    await expect(page.locator(".preview__flow h2")).toHaveText("Clipboard heading");
});

test("pastes inline Markdown formatting from the system clipboard", async ({
    page,
    browserName
}) => {
    test.skip(
        browserName !== "chromium",
        "Playwright exposes system clipboard permissions only in Chromium."
    );
    await page.goto("/");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(() => navigator.clipboard.writeText("**bold** and *italic*"));

    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.focus();
    await editor.press("Control+End");
    await editor.press("Control+V");

    await expect(editor.locator("strong")).toHaveText("bold");
    await expect(editor.locator("em")).toHaveText("italic");
    await expect(editor.locator("strong")).toHaveCount(1);
    await expect(editor.locator("em")).toHaveCount(1);
    await expect(page.locator(".preview__flow strong")).toHaveText("bold");
    await expect(page.locator(".preview__flow em")).toHaveText("italic");
});

test("keeps the insertion point when math editing loads after typing begins", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.press("Control+a");
    await editor.pressSequentially("A formula $x^2$ followed by text");

    await expect(page.locator(".preview__flow .katex")).toHaveCount(1, { timeout: 15_000 });
    await editor.pressSequentially(" and more.");
    await expect(page.locator(".preview__flow")).toContainText("followed by text and more.");

    await page.getByRole("button", { name: "Source", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(source).toContainText("$x^2$");
    await expect(source).toContainText("followed by text and more.");
});

test("renders chemistry commands in the rich editor after loading math on demand", async ({
    page
}) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const source = page.getByRole("textbox", { name: "Markdown editor" });
    await source.fill("Water is $\\ce{H2O}$ and a quantity is $\\pu{3.2 kg}$. ");
    await page.getByRole("button", { name: "Rich", exact: true }).click();

    const richEditor = page.locator(".rich-editor__surface");
    await expect(richEditor.locator(".katex")).toHaveCount(2, { timeout: 15_000 });
    await expect(richEditor.locator(".katex-error")).toHaveCount(0);

    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText("\\ce{H2O}");
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText(
        "\\pu{3.2 kg}"
    );
});

test("loads chemistry support when a chemistry formula is added to an open math editor", async ({
    page
}) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.press("Control+a");
    await editor.pressSequentially("A formula $x^2$");

    const richSurface = page.locator(".rich-editor__surface");
    await expect(richSurface.locator(".katex")).toHaveCount(1, { timeout: 15_000 });
    await editor.pressSequentially(" and water $\\ce{H2O}$");

    await expect(richSurface.locator(".katex")).toHaveCount(2, { timeout: 15_000 });
    await expect(richSurface.locator(".katex-error")).toHaveCount(0);
    await expect(page.locator(".preview__flow .katex-error")).toHaveCount(0);
});

test("accepts multilingual text across a composition lifecycle", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.focus();
    await editor.evaluate((element) => {
        element.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true, data: "" })
        );
    });
    await page.keyboard.insertText("漢字 café");
    await editor.evaluate((element) => {
        element.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true, data: "漢字 café" })
        );
    });

    await expect(editor).toContainText("漢字 café");
    await expect(page.locator(".preview__flow p")).toHaveText("漢字 café");
});

test("exposes the writing surface and toolbar accessibly and hides inactive rich controls", async ({
    page
}) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await expect(editor).toHaveAttribute("aria-multiline", "true");
    await expect(page.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();

    await page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(page.locator(".rich-editor__surface")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".rich-editor__surface")).toHaveAttribute("inert", "");
});
