import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync, zipSync } from "fflate";

test("saves a recovered book as a complete archive", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem(
            "markdown-exporter:recovery-draft",
            JSON.stringify({
                savedAt: 1,
                source: "# First chapter",
                activeEntryId: "one",
                bookProject: {
                    manifest: {
                        formatVersion: 1,
                        metadata: { title: "Recovered book", authors: [], language: "en" },
                        entries: [
                            { id: "one", role: "chapter", path: "one.md", title: "First chapter" },
                            { id: "two", role: "chapter", path: "two.md", title: "Second chapter" }
                        ]
                    },
                    files: { "one.md": "# First chapter", "two.md": "# Second chapter" }
                }
            })
        );
    });
    await page.goto("/");
    await expect(page.locator(".editor-footer")).toContainText("Recovered the book project");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("recovered-book.mdbook");
    const archive = unzipSync(await readFile(await saved.path()));
    expect(strFromU8(archive["one.md"]!)).toBe("# First chapter");
    expect(strFromU8(archive["two.md"]!)).toBe("# Second chapter");
});

test("creates only one source editor when startup and a mode switch overlap", async ({ page }) => {
    let releaseRuntime!: () => void;
    const runtimeGate = new Promise<void>((resolve) => {
        releaseRuntime = resolve;
    });
    await page.route(/\/assets\/CodeMirrorRuntime-[^/]+\.js$/, async (route) => {
        await runtimeGate;
        await route.continue();
    });
    await page.addInitScript(() => {
        Object.defineProperty(window, "indexedDB", {
            value: {
                open: () => {
                    const request: { onerror?: () => void } = {};
                    (window as unknown as { releaseRecovery: () => void }).releaseRecovery = () =>
                        request.onerror?.();
                    return request;
                }
            }
        });
    });
    await page.goto("/");
    const runtimeRequested = page.waitForRequest(/\/assets\/CodeMirrorRuntime-[^/]+\.js$/);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await runtimeRequested;
    await page.evaluate(async () => {
        (window as unknown as { releaseRecovery: () => void }).releaseRecovery();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    releaseRuntime();
    await expect(page.getByRole("button", { name: "New document", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Markdown editor", exact: true })).toHaveCount(
        1
    );
});

test("does not overwrite new typing when slow draft recovery finishes", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem(
            "markdown-exporter:recovery-draft",
            JSON.stringify({ source: "# Older recovered draft", savedAt: 1 })
        );
        Object.defineProperty(window, "indexedDB", {
            configurable: true,
            value: {
                open: () => {
                    const request: { onerror?: () => void } = {};
                    (window as unknown as { releaseRecovery: () => void }).releaseRecovery = () =>
                        request.onerror?.();
                    return request;
                }
            }
        });
    });
    await page.goto("/");
    await page.getByRole("textbox", { name: "Markdown editor" }).evaluate((element) => {
        element.focus();
        document.execCommand("insertText", false, "Keep the new typing");
        // Resolve recovery before the rich editor's synchronization timer fires.
        (window as unknown as { releaseRecovery: () => void }).releaseRecovery();
    });
    await expect(page.getByRole("button", { name: "New document", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText(
        "Keep the new typing"
    );
});

test("exports a book when the selected chapter is empty", async ({ page }) => {
    await page.addInitScript(() =>
        Object.defineProperty(window, "showOpenFilePicker", {
            value: undefined,
            configurable: true
        })
    );
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open book", exact: true }).click();
    await (
        await chooser
    ).setFiles({
        name: "book.mdbook",
        mimeType: "application/zip",
        buffer: Buffer.from(
            zipSync({
                "book.json": new TextEncoder().encode(
                    JSON.stringify({
                        formatVersion: 1,
                        metadata: { title: "My book", authors: [], language: "en" },
                        entries: [
                            { id: "one", role: "chapter", path: "one.md", title: "Empty draft" },
                            { id: "two", role: "chapter", path: "two.md", title: "Written chapter" }
                        ]
                    })
                ),
                "one.md": new Uint8Array(),
                "two.md": new TextEncoder().encode("# Written chapter\n\nThis must be exported.")
            })
        )
    });
    await expect(page.locator(".editor-footer")).toContainText("Opened book.mdbook");
    await page.getByRole("button", { name: "Choose export format" }).click();
    await page.getByRole("menuitem", { name: "HTML", exact: true }).click();
    await expect(page.locator(".statusbar")).toContainText("Saved HTML");
});

test("exports the last rich-editor keystroke without waiting for the sync timer", async ({
    page
}) => {
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "Markdown editor" });
    await editor.fill("Original text");
    await expect(page.locator(".preview__flow")).toContainText("Original text");
    await page.getByRole("button", { name: "Choose export format" }).click();
    const download = page.waitForEvent("download");
    // A real input event followed by export in the same task deterministically
    // covers the interval before the rich editor's 120 ms synchronization.
    await editor.evaluate((element) => {
        element.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, "The final edited sentence.");
        document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="HTML"]')!.click();
    });
    const exported = await download;
    expect(await readFile(await exported.path(), "utf8")).toContain("The final edited sentence.");
});
