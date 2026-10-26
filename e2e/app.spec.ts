import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);

const SAMPLE = [
    "# Release notes",
    "",
    "The exporter converts Markdown to PDF inside the browser.",
    "",
    "## What is new",
    "",
    "- live preview with page boundaries",
    "- page size and margin options",
    "- syntax highlighting",
    "",
    "| Feature | State |",
    "| --- | --- |",
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
    await expect(status).toContainText("Chars");
    await expect(status).toContainText("Pages");
    await expect(status).toContainText("Render");
    await expect(status).not.toContainText("Local only");
});

test("virtualizes the canvases for off-screen preview pages", async ({ page }) => {
    await page.goto("/");
    const long = Array.from(
        { length: 260 },
        (_, index) =>
            `Paragraph ${index + 1} has enough text to span several lines in the document.`
    ).join("\n\n");
    await page.getByLabel("Markdown editor").fill(long);
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(3);
    await expect
        .poll(async () => page.locator(".page-canvas").count())
        .toBeLessThan(await page.locator(".page-frame").count());
});

test("shows the empty state before anything is typed", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".preview__placeholder")).toHaveText(
        "Your document will appear here."
    );
    await expect(page.locator(".page-frame")).toHaveCount(1);
});

test("lazy editor startup does not steal focus from another control", async ({ page }) => {
    await page.route(/\/assets\/EditorPane-[^/]+\.js(?:\?.*)?$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
    });
    const editorChunk = page.waitForRequest(/\/assets\/EditorPane-[^/]+\.js(?:\?.*)?$/);

    await page.goto("/");
    await editorChunk;
    const divider = page.getByRole("separator");
    await divider.focus();
    await expect(page.getByLabel("Markdown editor")).toBeVisible();
    await expect(divider).toBeFocused();
});

test("source and inline modes share the Markdown document and undo history", async ({ page }) => {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill("**bold** and $x^2$");

    await page.getByRole("button", { name: "Inline" }).click();
    await expect(page.locator(".cm-md-bold")).toHaveText("bold");
    await expect(page.locator(".cm-math-inline .katex")).toHaveCount(1);

    await page.getByRole("button", { name: "Source" }).click();
    await expect(editor).toContainText("**bold** and $x^2$");
    await editor.press("Control+z");
    await expect(editor).toHaveText("");
});

test("inline mode decorates short emphasis and renders Pandoc raw TeX spans", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill("A *go* _up_ ~~away~~ ==now== with `\\alpha`{=tex}.");
    await page.getByRole("button", { name: "Inline" }).click();

    await expect(page.locator(".cm-md-italic").nth(0)).toHaveText("go");
    await expect(page.locator(".cm-md-italic").nth(1)).toHaveText("up");
    await expect(page.locator(".cm-md-strike")).toHaveText("away");
    await expect(page.locator(".cm-md-highlight")).toHaveText("now");
    await expect(page.locator(".cm-math-inline .katex")).toHaveCount(1);
    expect(errors).toEqual([]);
});

test("measures preview math at the page width before painting it", async ({ page }) => {
    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill("Inline $x^2$ and display:\n\n\\[\\frac{1}{2}\\]");
    await expect(page.locator(".preview__flow .katex")).toHaveCount(2);

    const flowWidth = await page
        .locator(".preview__flow")
        .evaluate((element) => element.getBoundingClientRect().width);
    const displayHeight = await page
        .locator(".preview__flow .katex-display .katex")
        .evaluate((element) => element.getBoundingClientRect().height);
    expect(flowWidth).toBeGreaterThan(500);
    expect(displayHeight).toBeGreaterThan(10);
    expect(displayHeight).toBeLessThan(100);
});

test("preserves display-mode sum layout in the paginated preview", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Markdown editor").fill("\\[a \\cdot b = \\sum_{i=1}^{n} a_i b_i.\\]");
    const overlay = page.locator(".page-math-overlay");
    await expect(overlay).toHaveCount(1);

    const rendered = await overlay.evaluate((element) => {
        const display = element.firstElementChild;
        if (!(display instanceof HTMLElement)) return null;
        const math = display.querySelector<HTMLElement>(".katex");
        const html = math?.querySelector<HTMLElement>(".katex-html");
        if (math === null || math === undefined || html === null || html === undefined) return null;
        const bounds = math.getBoundingClientRect();
        const limitOffsets = Array.from(
            math.querySelectorAll<HTMLElement>(".op-limits > .vlist-t > .vlist-r > .vlist > span")
        ).map((row) => row.style.top);
        return {
            keepsDisplayWrapper: display.classList.contains("katex-display"),
            mathDisplay: getComputedStyle(math).display,
            htmlDisplay: getComputedStyle(html).display,
            width: bounds.width,
            wrapperWidth: display.getBoundingClientRect().width,
            limitOffsets
        };
    });
    expect(rendered).not.toBeNull();
    expect(rendered?.keepsDisplayWrapper).toBe(true);
    expect(rendered?.mathDisplay).toBe("block");
    expect(rendered?.htmlDisplay).toBe("block");
    expect(rendered?.width).toBeGreaterThan(500);
    expect(rendered?.wrapperWidth).toBeGreaterThan(500);
    expect(rendered?.limitOffsets.slice(0, 3).every((offset) => offset.length > 0)).toBe(true);
    expect(new Set(rendered?.limitOffsets.slice(0, 3)).size).toBe(3);
});

test("renders copied double-escaped TeX consistently in preview and inline mode", async ({
    page
}) => {
    const slash = "\\\\";
    const source = [
        "For vectors (a,b `" + slash + "in `{=tex}`" + slash + "mathbb{R}`{=tex}" + slash + "^n),",
        "",
        slash +
            "[ a `" +
            slash +
            "cdot `{=tex}b = `" +
            slash +
            "sum`{=tex}" +
            slash +
            "_{i=1}" +
            slash +
            "^{n} a_i b_i. " +
            slash +
            "]",
        "",
        slash +
            "[ p" +
            slash +
            "_{t+1}=`" +
            slash +
            "alpha `{=tex}Pp_t+(1-`" +
            slash +
            "alpha`{=tex})u. " +
            slash +
            "]"
    ].join("\n");
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(source);

    await expect(page.locator(".preview__flow .katex-display .katex")).toHaveCount(2);
    await expect(page.locator(".preview__flow .katex-error")).toHaveCount(0);
    await expect(page.locator(".page-math-overlay .katex-display")).toHaveCount(2);
    const alignment = await page
        .locator(".page-math-overlay .katex-display")
        .first()
        .evaluate((display) => {
            const math = display.querySelector<HTMLElement>(".katex");
            const html = math?.querySelector<HTMLElement>(".katex-html");
            const limitOffsets = Array.from(
                math?.querySelectorAll<HTMLElement>(
                    ".op-limits > .vlist-t > .vlist-r > .vlist > span"
                ) ?? []
            ).map((row) => row.style.top);
            return {
                mathDisplay: math === null ? "missing" : getComputedStyle(math).display,
                htmlDisplay:
                    html === null || html === undefined
                        ? "missing"
                        : getComputedStyle(html).display,
                width: math?.getBoundingClientRect().width ?? 0,
                limitOffsets
            };
        });
    expect(alignment.mathDisplay).toBe("block");
    expect(alignment.htmlDisplay).toBe("block");
    expect(alignment.width).toBeGreaterThan(500);
    expect(alignment.limitOffsets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(alignment.limitOffsets.slice(0, 3)).size).toBe(3);
    await page.screenshot({ path: "test-results/copied-tex-preview.png" });

    await page.getByRole("button", { name: "Inline" }).click();
    await expect(page.locator(".cm-math-display .katex")).toHaveCount(2);
    await expect(page.locator(".cm-math-inline .katex")).toHaveCount(1);
    await expect(page.locator(".cm-math-error")).toHaveCount(0);
});

test("inline mode renders multiline and fenced math without changing source", async ({ page }) => {
    await page.goto("/");
    const source = "\\[\n\\frac{1}{2}\n\\]\n\n```math\n\\sqrt{x}\n```";
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(source);

    await page.getByRole("button", { name: "Inline" }).click();

    await expect(page.locator(".cm-math-display .katex")).toHaveCount(2);
    await page.getByRole("button", { name: "Source" }).click();
    await expect
        .poll(() => editor.locator(".cm-line").allTextContents())
        .toEqual(source.split("\n"));
});

test("inline mode restores Markdown after scrolling through a fenced code block", async ({
    page
}) => {
    const source = [
        "# Before the example",
        "```text",
        ...Array.from(
            { length: 40 },
            (_, index) => `Code example ${index + 1}: **keep these markers literal**`
        ),
        "```",
        "## Back in Markdown",
        "**This emphasis should render.**"
    ].join("\n");

    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(source);
    await page.getByRole("button", { name: "Inline" }).click();
    await page.locator(".cm-scroller").evaluate((element) => {
        element.scrollTop = element.scrollHeight * 0.7;
    });

    await expect(page.locator(".cm-md-heading").filter({ hasText: "Back in Markdown" })).toHaveText(
        "Back in Markdown"
    );
    await expect(
        page.locator(".cm-md-bold").filter({ hasText: "This emphasis should render." })
    ).toHaveText("This emphasis should render.");
    await expect(
        page.locator(".cm-md-code-block").filter({ hasText: "keep these markers literal" }).first()
    ).toContainText("**keep these markers literal**");
});

test("inline math keeps full-document fence context beyond the editor viewport", async ({
    page
}) => {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    const source =
        "```text\n" +
        "ordinary code\n".repeat(220) +
        "$this_is_code$\n" +
        "more code\n".repeat(5) +
        "```";
    await editor.fill(source);
    await page.getByRole("button", { name: "Inline" }).click();
    await editor.press("Control+End");

    await expect(page.locator(".cm-math-inline")).toHaveCount(0);
});

test("inline mode renders a long math fence and loads offscreen chemistry support", async ({
    page
}) => {
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    const source =
        "```math\n" +
        " ".repeat(3000) +
        "x + y\n```\n\n" +
        "ordinary text\n".repeat(120) +
        "\n$\\ce{H2O -> H+ + OH-}$";
    await editor.fill(source);
    await editor.press("Control+Home");
    await page.getByRole("button", { name: "Inline" }).click();

    await expect(page.locator(".cm-math-display .katex")).toHaveCount(1);
    await editor.press("Control+End");
    await expect(page.locator(".cm-math-inline .katex")).toHaveCount(1);
    await expect(page.locator(".cm-math-inline .katex-error")).toHaveCount(0);
});

test("inline math resolves chemistry commands, equation labels, and references", async ({
    page
}) => {
    const source =
        "\\[\\ce{H2O -> H+ + OH-}\\label{eq:water}\\]\n\n" +
        "See \\eqref{eq:water} and reference \\ref{eq:water}.";
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill(source);
    await page.getByRole("button", { name: "Inline" }).click();

    await expect(page.locator(".cm-math-display .katex")).toHaveCount(1);
    await expect(page.locator(".cm-math-display .katex-error")).toHaveCount(0);
    await expect(page.locator(".cm-math-reference")).toHaveCount(2);
    await expect(page.locator(".cm-math-reference").nth(0)).toHaveText("(1)");
    await expect(page.locator(".cm-math-reference").nth(1)).toHaveText("1");

    await page.getByRole("button", { name: "Source" }).click();
    await expect
        .poll(() => editor.locator(".cm-line").allTextContents())
        .toEqual(source.split("\n"));
});

test("opens a Markdown file through the picker fallback and recovers its local draft", async ({
    page
}) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: undefined
        });
        Object.defineProperty(window, "showSaveFilePicker", {
            configurable: true,
            value: undefined
        });
    });
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open file" }).click();
    await (
        await chooser
    ).setFiles({
        name: "imported.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Imported locally\n\nRecovery stays on device.")
    });

    const editor = page.getByLabel("Markdown editor");
    await expect(editor).toContainText("# Imported locally");
    await expect(page.locator(".preview__flow h1")).toHaveText("Imported locally");
    await expect(page.locator(".editor-footer")).toContainText("Draft recovered automatically");

    await page.reload();
    await expect(page.getByLabel("Markdown editor")).toContainText("# Imported locally");
    await expect(page.locator(".editor-footer")).toContainText("Recovered a local draft");
});

test("shows a filtered folder sidebar through the directory-picker fallback", async ({
    page
}, testInfo) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, "showDirectoryPicker", {
            configurable: true,
            value: undefined
        });
    });
    await page.goto("/");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open folder" }).click();
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(true);
    const selectedFolder = testInfo.outputPath("markdown-folder");
    const nestedFolder = join(selectedFolder, "nested");
    await mkdir(nestedFolder, { recursive: true });
    await writeFile(join(selectedFolder, "first.md"), "# First fallback note");
    await writeFile(join(nestedFolder, "second.markdown"), "# Second fallback note");
    await writeFile(join(selectedFolder, "image.png"), "ignored");
    await chooser.setFiles(selectedFolder);

    await expect.poll(() => page.locator(".file-sidebar__file").count()).toBe(2);
    await expect(page.locator(".file-sidebar__file").filter({ hasText: "first.md" })).toBeVisible();
    await expect(
        page.locator(".file-sidebar__file").filter({ hasText: "second.markdown" })
    ).toBeVisible();
    await expect(page.locator(".file-sidebar__file").filter({ hasText: "image.png" })).toHaveCount(
        0
    );
    await page.getByRole("button", { name: /second\.markdown$/ }).click();
    await expect(page.getByLabel("Markdown editor")).toContainText("# Second fallback note");
});

test("opens a local folder, edits its Markdown file, and saves through its handle", async ({
    page
}) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, "__savedMarkdown", {
            configurable: true,
            writable: true,
            value: ""
        });
        const handle = {
            kind: "file" as const,
            name: "note.md",
            getFile: () =>
                Promise.resolve(new File(["# Folder note"], "note.md", { type: "text/markdown" })),
            createWritable: () =>
                Promise.resolve({
                    write: (source: string) => {
                        (
                            window as unknown as Window & { __savedMarkdown: string }
                        ).__savedMarkdown = source;
                        return Promise.resolve();
                    },
                    close: () => Promise.resolve()
                })
        };
        const directory = {
            kind: "directory" as const,
            name: "Notes",
            async *values() {
                await Promise.resolve();
                yield handle;
            },
            getFileHandle: () => Promise.resolve(handle)
        };
        Object.defineProperty(window, "showDirectoryPicker", {
            configurable: true,
            value: () => Promise.resolve(directory)
        });
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.getByRole("complementary", { name: "Notes files" })).toBeVisible();
    await page.getByRole("button", { name: "note.md" }).click();
    const editor = page.getByLabel("Markdown editor");
    await expect(editor).toContainText("# Folder note");
    await editor.fill("# Updated in folder");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.locator(".editor-footer")).toContainText("Saved note.md.");
    await expect
        .poll(() =>
            page.evaluate(
                () => (window as unknown as Window & { __savedMarkdown: string }).__savedMarkdown
            )
        )
        .toBe("# Updated in folder");
});

test("switching documents never leaves a stale file or folder save target", async ({ page }) => {
    await page.addInitScript(() => {
        const state = { native: "", folder: "", folderWrites: 0 };
        Object.defineProperty(window, "__saveTargets", {
            configurable: true,
            value: state
        });
        const makeFile = (name: string, key: "native" | "folder", source: string) => ({
            kind: "file" as const,
            name,
            getFile: () => Promise.resolve(new File([source], name, { type: "text/markdown" })),
            createWritable: () =>
                Promise.resolve({
                    write: (next: string) => {
                        state[key] = next;
                        if (key === "folder") state.folderWrites += 1;
                        return Promise.resolve();
                    },
                    close: () => Promise.resolve()
                })
        });
        const nativeFile = makeFile("original.md", "native", "# Original file");
        const folderFile = makeFile("original.md", "folder", "# Folder copy");
        const directory = {
            kind: "directory" as const,
            name: "Notes",
            async *values() {
                await Promise.resolve();
                yield folderFile;
            },
            getFileHandle: () => Promise.resolve(folderFile)
        };
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: () => Promise.resolve([nativeFile])
        });
        Object.defineProperty(window, "showDirectoryPicker", {
            configurable: true,
            value: () => Promise.resolve(directory)
        });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Open file" }).click();
    await expect(page.getByLabel("Markdown editor")).toContainText("# Original file");

    await page.getByRole("button", { name: "Open folder" }).click();
    await expect(page.getByRole("complementary", { name: "Notes files" })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".editor-footer")).toContainText("Saved original.md in Notes.");
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    (window as unknown as { __saveTargets: { folder: string } }).__saveTargets
                        .folder
            )
        )
        .toBe("# Original file");
    expect(
        await page.evaluate(
            () => (window as unknown as { __saveTargets: { native: string } }).__saveTargets.native
        )
    ).toBe("");

    await page.evaluate(() => {
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: undefined
        });
    });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open file" }).click();
    await (
        await chooserPromise
    ).setFiles({
        name: "fallback.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Fallback document")
    });
    await expect(page.getByLabel("Markdown editor")).toContainText("# Fallback document");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("fallback.md");
    expect(
        await page.evaluate(
            () =>
                (window as unknown as { __saveTargets: { folderWrites: number } }).__saveTargets
                    .folderWrites
        )
    ).toBe(1);
});

test("keeps recovery after save permission is denied and downloads through the fallback", async ({
    page
}) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, "showSaveFilePicker", {
            configurable: true,
            value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
        });
    });
    await page.goto("/");
    const editor = page.getByLabel("Markdown editor");
    await editor.fill("# Private note\n\nKeep this draft on device.");
    await page.getByRole("button", { name: "Save as" }).click();
    await expect(page.locator(".editor-footer")).toContainText("Permission denied");
    await expect(page.locator(".editor-footer")).toContainText("local recovery draft is preserved");
    await expect(page.locator(".editor-footer")).toContainText("Draft recovered automatically");

    await page.reload();
    await expect(page.getByLabel("Markdown editor")).toContainText("# Private note");
    await expect(page.locator(".editor-footer")).toContainText("Recovered a local draft");
    await page.evaluate(() => {
        Object.defineProperty(window, "showSaveFilePicker", {
            configurable: true,
            value: undefined
        });
    });

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save as" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("untitled.md");
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("Keep this draft on device.");
});

test("does not load KaTeX or Mermaid for plain Markdown or currency", async ({ page }) => {
    const featureRequests: string[] = [];
    page.on("request", (request) => {
        if (/katex|mermaid|mhchem|diagram|rehype-highlight|rehype-raw/i.test(request.url())) {
            featureRequests.push(request.url());
        }
    });

    await page.goto("/");
    await page.getByLabel("Markdown editor").fill("Plain notes. Price: $2 and $3 per item.");
    await expect(page.locator(".preview__flow p")).toHaveText(
        "Plain notes. Price: $2 and $3 per item."
    );

    expect(featureRequests).toEqual([]);
});

test("loads code highlighting and raw HTML parsing only when those features are used", async ({
    page
}) => {
    const featureRequests = new Set<string>();
    page.on("request", (request) => {
        if (/rehype-highlight|rehype-raw/i.test(request.url())) featureRequests.add(request.url());
    });

    await page.goto("/");
    await page
        .getByLabel("Markdown editor")
        .fill("```js\nconst value = 1;\n```\n\n<em>Safe markup</em>");
    await expect(page.locator(".preview__flow .hljs-keyword")).toHaveText("const");
    await expect(page.locator(".preview__flow em")).toHaveText("Safe markup");
    await expect.poll(() => featureRequests.size).toBe(2);
});

test("shares one KaTeX runtime between inline editing and the preview", async ({ page }) => {
    const katexScripts = new Set<string>();
    page.on("request", (request) => {
        if (/\/assets\/katex-[^/]+\.js$/.test(request.url())) katexScripts.add(request.url());
    });

    await page.goto("/");
    await page.getByLabel("Markdown editor").fill("$x^2 + 1$");
    await expect(page.locator(".preview__flow .katex")).toHaveCount(1);
    await page.getByRole("button", { name: "Inline" }).click();
    await expect(page.locator(".cm-math-inline .katex")).toHaveCount(1);

    expect(katexScripts.size).toBe(1);
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

test("applies page setup changes to the preview", async ({ page }) => {
    await page.goto("/");
    const long = Array.from(
        { length: 140 },
        (_, index) => `Paragraph ${index + 1} with enough words to fill a line of text.`
    ).join("\n\n");
    await page.getByLabel("Markdown editor").fill(long);
    await expect.poll(async () => page.locator(".page-frame").count()).toBeGreaterThan(1);

    const frame = page.locator(".page-frame").first();
    const heightOf = async (): Promise<number> =>
        Math.round(
            await frame.evaluate((element) => Number.parseFloat(getComputedStyle(element).height))
        );
    const pagesOf = async (): Promise<number> => page.locator(".page-frame").count();
    expect(await heightOf()).toBe(1123);
    const pagesBefore = await pagesOf();
    expect(pagesBefore).toBeGreaterThan(1);

    await page.getByRole("button", { name: "Page setup" }).click();
    const sheet = page.getByRole("dialog", { name: "Page setup" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Page size").selectOption("letter");
    expect(await heightOf()).toBe(1056);

    await sheet.getByLabel("Margins").selectOption("30");
    const fontSize = sheet.getByLabel("Font size");
    await fontSize.fill("14");
    await fontSize.press("Enter");
    // The frames are painted from the same layout the export uses, so a larger
    // font and smaller margins have to push the document onto more pages.
    await expect.poll(pagesOf).toBeGreaterThan(pagesBefore);

    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
});

test("toggles between the light and dark theme", async ({ page }) => {
    await page.goto("/");
    const root = page.locator("html");
    const first = await root.getAttribute("data-theme");
    expect(first === "light" || first === "dark").toBe(true);

    await page.getByRole("button", { name: /theme/i }).click();
    const second = await root.getAttribute("data-theme");
    expect(second).not.toBe(first);

    const background = await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe(second === "dark" ? "rgb(10, 10, 10)" : "rgb(255, 255, 255)");

    await page.getByRole("button", { name: /theme/i }).click();
    await expect(root).toHaveAttribute("data-theme", first ?? "");
});

test("exports a real PDF file", async ({ page }) => {
    await load(page);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export/ }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe("release-notes.pdf");
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
    }
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.6");
    expect(bytes.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    await expect(page.locator(".statusbar")).toContainText("Saved PDF");
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

    await expect(page.locator(".page-canvas").first()).toBeVisible();
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
                axe: {
                    run: () => Promise<{
                        violations: Array<{
                            id: string;
                            nodes: Array<{ target: string[]; failureSummary?: string }>;
                        }>;
                    }>;
                };
            }
        ).axe;
        const result = await axe.run();
        return result.violations.flatMap((violation) =>
            violation.nodes.map(
                (node) => `${violation.id} ${node.target.join(" ")}: ${node.failureSummary ?? ""}`
            )
        );
    });
}

test("renders the Chinese-cities calculus sample without losing math or table layout", async ({
    page
}) => {
    const source = await readFile(
        new URL("./fixtures/chinese-cities-calculus.md", import.meta.url),
        "utf8"
    );
    await page.goto("/");
    await page.getByLabel("Markdown editor").fill(source);

    const preview = page.locator(".preview__flow");
    await expect(preview.locator("h2")).toHaveCount(6);
    await expect(preview.locator("table th")).toHaveCount(3);
    await expect(preview.locator("table tbody tr")).toHaveCount(5);
    await expect(preview.locator(".katex-display .katex")).toHaveCount(6);
    await expect(preview.locator(".katex")).toHaveCount(11);
    await expect(preview.locator(".katex-error")).toHaveCount(0);
    await expect(preview.locator(".katex-mathml math")).toHaveCount(11);
    await expect(preview).toContainText("上海市统计局");
    const annotations = await preview
        .locator(".katex annotation[encoding='application/x-tex']")
        .allTextContents();
    expect(annotations[7]).toBe(" L=\\int_0^{2\\pi}\\|\\mathbf r'(t)\\|\\,dt=2\\pi R. ");
    expect(annotations[9]).toBe(" P(R)=2\\pi\\int_0^R rD_0e^{-kr}\\,dr. ");
    const frames = page.locator(".page-frame");
    const paginatedMath: string[] = [];
    for (let index = 0; index < (await frames.count()); index += 1) {
        const frame = frames.nth(index);
        await frame.scrollIntoViewIfNeeded();
        await frame.locator(".page-canvas").waitFor();
        const pageMath = await frame
            .locator(".page-math-overlay annotation[encoding='application/x-tex']")
            .allTextContents();
        paginatedMath.push(...pageMath);
        if (pageMath.length === 0) continue;
        await frame.screenshot({
            path: join(
                process.cwd(),
                "test-results",
                `chinese-cities-preview-page-${index + 1}.png`
            )
        });
    }
    expect(paginatedMath).toHaveLength(11);
    expect(paginatedMath.filter((tex) => tex.includes("x=r"))).toHaveLength(1);
    expect(paginatedMath.filter((tex) => tex.includes("y=\\ln D"))).toHaveLength(1);

    await page.getByRole("button", { name: "Inline" }).click();
    const scroller = page.locator(".cm-scroller");
    const { scrollHeight, clientHeight } = await scroller.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
    }));
    const displayFormulas = new Set<string>();
    let maxInlineFormulas = 0;
    const step = Math.max(100, Math.floor(clientHeight * 0.75));
    for (let top = 0; top <= scrollHeight; top += step) {
        await scroller.evaluate((element, scrollTop) => {
            element.scrollTop = scrollTop;
        }, top);
        await page.waitForTimeout(40);
        const readFormulaLabels = async (selector: string): Promise<string[]> =>
            page
                .locator(selector)
                .evaluateAll((nodes) =>
                    nodes
                        .filter((node) => node.querySelector(".katex") !== null)
                        .map((node) => node.getAttribute("aria-label") ?? "")
                );
        for (const formula of await readFormulaLabels(".cm-math-display"))
            displayFormulas.add(formula);
        maxInlineFormulas = Math.max(
            maxInlineFormulas,
            (await readFormulaLabels(".cm-math-inline")).length
        );
    }
    expect([...displayFormulas]).toHaveLength(6);
    expect(maxInlineFormulas).toBe(5);
    await expect(page.locator(".cm-math-error")).toHaveCount(0);
    await page.getByRole("button", { name: "Source" }).click();
    const editor = page.getByLabel("Markdown editor");
    await editor.press("Control+f");
    const search = page.locator(".cm-search input").first();
    await search.fill("D(r)");
    await search.press("Enter");
    await editor.press("Escape");
    await expect(editor).toContainText("\\\\[");
});
