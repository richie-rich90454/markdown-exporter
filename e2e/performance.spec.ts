import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";

test("@perf keeps a 100,000-word book responsive while editing one chapter", async ({
    page
}, testInfo) => {
    test.skip(process.env.MARKDOWN_RUN_PERF !== "1", "Run this stress check with pnpm test:perf.");
    test.setTimeout(180_000);

    const entries = Array.from({ length: 100 }, (_, index) => ({
        id: `chapter-${index + 1}`,
        role: "chapter",
        path: `chapters/chapter-${index + 1}.md`,
        title: `Chapter ${index + 1}`
    }));
    const files: Record<string, Uint8Array> = {
        "book.json": new TextEncoder().encode(
            JSON.stringify({
                formatVersion: 1,
                metadata: { title: "A 100,000-word book", authors: [], language: "en" },
                entries
            })
        )
    };
    for (let chapter = 0; chapter < entries.length; chapter += 1) {
        const path = entries[chapter]?.path;
        if (path === undefined) continue;
        const source = Array.from({ length: 1_000 }, (_, word) => `word${chapter}x${word}`).join(
            " "
        );
        files[path] = new TextEncoder().encode(source);
    }
    const archive = zipSync(files, { level: 6 });

    await page.addInitScript(() => {
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: undefined
        });
    });
    await page.goto("/");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open book" }).click();
    await (
        await chooserPromise
    ).setFiles({
        name: "large-manuscript.mdbook",
        mimeType: "application/zip",
        buffer: Buffer.from(archive)
    });

    const editor = page.getByLabel("Markdown editor");
    const words = page
        .locator(".statusbar__item")
        .filter({ hasText: "Words" })
        .locator(".statusbar__value");
    const bookCount = page.locator(".book-tools__count");
    const pages = page
        .locator(".statusbar__item")
        .filter({ hasText: "Pages" })
        .locator(".statusbar__value");
    const renderTime = page
        .locator(".statusbar__item")
        .filter({ hasText: "Render" })
        .locator(".statusbar__value");

    const loadStarted = Date.now();
    await expect(bookCount).toContainText("100,000 words in the manuscript", { timeout: 120_000 });
    await expect(editor).toContainText("word0x0");
    await expect(words).toHaveText("1000");
    await expect(pages).not.toHaveText("0", { timeout: 120_000 });
    const loadDurationMs = Date.now() - loadStarted;

    const relayoutComplete = page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                const stack = document.querySelector(".preview__stack");
                if (stack === null) {
                    resolve();
                    return;
                }
                const observer = new MutationObserver((records) => {
                    if (
                        records.some((record) =>
                            Array.from(record.addedNodes).some(
                                (node) =>
                                    node instanceof HTMLElement &&
                                    node.classList.contains("page-frame")
                            )
                        )
                    ) {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(stack, { childList: true });
            })
    );
    const editStarted = Date.now();
    await editor.press("Control+End");
    await editor.pressSequentially(" Additional sentence.");
    await expect(words).toHaveText("1002", { timeout: 15_000 });
    await relayoutComplete;
    await expect(bookCount).toContainText("100,002 words in the manuscript");
    const appendDurationMs = Date.now() - editStarted;
    const rendererDurationMs = Number.parseInt((await renderTime.textContent()) ?? "0", 10);
    const metrics = {
        manuscriptWords: 100_000,
        activeChapterWords: 1_002,
        initialLayoutMs: loadDurationMs,
        editLayoutMs: appendDurationMs,
        markdownRendererMs: rendererDurationMs
    };

    testInfo.annotations.push({
        type: "performance",
        description: JSON.stringify(metrics)
    });
    await testInfo.attach("100000-word-performance.json", {
        body: JSON.stringify(metrics, null, 2),
        contentType: "application/json"
    });
    expect(
        appendDurationMs,
        "Editing one chapter should not lay out the entire 100,000-word book."
    ).toBeLessThan(5_000);
});
