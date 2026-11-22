import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync, zipSync } from "fflate";

test("creates a named template, renders it, and recovers edits after reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Browse templates" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Meeting notes/ }).check();
    await dialog.getByRole("textbox", { name: "Document name" }).fill("Weekly planning");
    await dialog.getByRole("button", { name: "Create document", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".preview__flow h1")).toHaveText("Weekly planning");
    await expect(
        page.locator(".preview__flow p").filter({ hasText: "Add meeting date" }).locator("br")
    ).toHaveCount(1);
    await expect(page.locator(".preview__flow table")).toHaveCount(1);
    await expect(page.locator(".editor-toolbar__filename")).toHaveText("weekly-planning.md");
    await expect(page.locator(".editor-footer")).toContainText("Draft saved automatically");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page
        .getByLabel("Markdown editor")
        .fill("# Weekly planning\n\nA decision we want to keep.");
    await expect(page.locator(".editor-footer")).toContainText("Unsaved changes");
    await expect(page.locator(".editor-footer")).toContainText("Draft saved automatically");
    await page.reload();
    await expect(page.locator(".preview__flow")).toContainText("A decision we want to keep.");
    await expect(page.getByRole("button", { name: "Browse templates" })).not.toBeVisible();
});

test("backs up the exact current source before creating a blank document", async ({ page }) => {
    const original = "# Keep this\n\nUnfinished **work** with $x^2$.\n";
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill(original);
    await page.getByRole("button", { name: "New document", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup & create" }).click();
    const backup = await download;
    expect(backup.suggestedFilename()).toBe("untitled-backup.md");
    expect(await readFile(await backup.path(), "utf8")).toBe(original);
    await expect(page.getByLabel("Markdown editor")).toHaveText("");
    await expect(page.locator(".preview__flow h1")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Browse templates" })).toBeVisible();
    await expect(page.locator(".editor-footer")).toContainText("Draft saved automatically");
    await page.reload();
    await expect(page.locator(".preview__flow h1")).toHaveCount(0);
});

test("cancels creation without changing the document and restores focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("Keep my work");
    const trigger = page.getByRole("button", { name: "New document", exact: true });
    await trigger.click();
    await page.getByRole("radio", { name: /Project brief/ }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel("Markdown editor")).toHaveText("Keep my work");
});

test("backs up all book chapters and assets before starting a document", async ({ page }) => {
    const files = {
        "book.json": new TextEncoder().encode(
            JSON.stringify({
                formatVersion: 1,
                metadata: { title: "Field notes", authors: [], language: "en" },
                entries: [
                    { id: "one", role: "chapter", path: "one.md", title: "One" },
                    { id: "two", role: "chapter", path: "two.md", title: "Two" }
                ]
            })
        ),
        "one.md": new TextEncoder().encode("# One\n\nFirst chapter."),
        "two.md": new TextEncoder().encode("# Two\n\nSecond chapter."),
        "assets/data.bin": new Uint8Array([1, 2, 3, 4])
    };
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
        name: "field-notes.mdbook",
        mimeType: "application/zip",
        buffer: Buffer.from(zipSync(files))
    });
    await expect(page.locator(".preview__flow h1")).toHaveText("One");
    await page.getByRole("button", { name: "New document", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup & create" }).click();
    const backup = await download;
    expect(backup.suggestedFilename()).toBe("field-notes-backup.mdbook");
    const archive = unzipSync(await readFile(await backup.path()));
    expect(strFromU8(archive["one.md"]!)).toBe("# One\n\nFirst chapter.");
    expect(strFromU8(archive["two.md"]!)).toBe("# Two\n\nSecond chapter.");
    expect(Array.from(archive["assets/data.bin"]!)).toEqual([1, 2, 3, 4]);
    await expect(page.locator("#manuscript-sidebar")).not.toBeVisible();
});

test("shows export guidance and remembers the selected format", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("# Share this\n\nA useful document.");
    await page.getByRole("button", { name: "Choose export format" }).click();
    await expect(page.getByRole("menu")).toContainText("Continue editing in Word or Google Docs");
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "HTML", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("share-this.html");
    await expect(page.getByRole("button", { name: "Export HTML", exact: true })).toBeEnabled();
});

test("keeps the template chooser usable on a small phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "New document", exact: true }).click();
    await page.getByRole("radio", { name: /How-to guide/ }).check();
    await page.getByRole("button", { name: "Create document", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Markdown editor" })).toContainText(
        "What you will learn"
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390
    );
});
