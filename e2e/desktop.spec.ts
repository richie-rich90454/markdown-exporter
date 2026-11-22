import { expect, test, type Page } from "@playwright/test";

async function desktop(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const files: Record<string, string> = {
            document: btoa("# Native document\n\nLocal writing.")
        };
        const state = {
            writes: [] as { name: string; data: string }[],
            cancelled: false,
            closed: false,
            recoveryFailed: false,
            savePaused: false,
            recoveryPaused: false,
            recoveryStarted: false,
            chooseSaveCount: 0
        };
        Object.assign(window, {
            desktopTest: {
                state,
                files,
                emit: (name: string, ...args: unknown[]) =>
                    listeners[name]?.forEach((handler) => handler(...args))
            }
        });
        window.runtime = {
            EventsOn: (name, callback) => {
                (listeners[name] ??= []).push(callback);
                return () => {
                    listeners[name] = listeners[name]!.filter((handler) => handler !== callback);
                };
            }
        };
        window.go = {
            main: {
                App: {
                    ChooseFile: () =>
                        Promise.resolve({ id: "document", name: "native.md", kind: "file" }),
                    ChooseSave: (name) => {
                        state.chooseSaveCount++;
                        return Promise.resolve(
                            state.cancelled ? null : { id: `save:${name}`, name, kind: "file" }
                        );
                    },
                    ChooseFolder: () => Promise.resolve(null),
                    Child: () => Promise.reject(new Error("NotFoundError: absent")),
                    List: () => Promise.resolve([]),
                    ReadFile: (id) => Promise.resolve({ data: files[id] ?? "", modified: 1 }),
                    WriteFile: async (id, data) => {
                        while (state.savePaused)
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        files[id] = data;
                        state.writes.push({ name: id, data });
                        return Promise.resolve();
                    },
                    RemoveFile: () => Promise.resolve(),
                    LoadRecovery: () =>
                        Promise.resolve(localStorage.getItem("desktop-recovery") ?? ""),
                    SaveRecovery: async (snapshot) => {
                        state.recoveryStarted = true;
                        while (state.recoveryPaused)
                            await new Promise((resolve) => setTimeout(resolve, 20));
                        if (state.recoveryFailed) return Promise.reject(new Error("Disk full"));
                        localStorage.setItem("desktop-recovery", snapshot);
                        return Promise.resolve();
                    },
                    Ready: () => Promise.resolve(),
                    ConfirmClose: () => {
                        state.closed = true;
                        return Promise.resolve();
                    },
                    ShowPrivacy: () => Promise.resolve()
                }
            }
        };
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New document", exact: true })).toBeEnabled();
}

declare global {
    interface Window {
        desktopTest: {
            state: {
                writes: { name: string; data: string }[];
                cancelled: boolean;
                closed: boolean;
                recoveryFailed: boolean;
                savePaused: boolean;
                recoveryPaused: boolean;
                recoveryStarted: boolean;
                chooseSaveCount: number;
            };
            emit: (name: string, ...args: unknown[]) => void;
        };
    }
}

test("uses native open and save without browser file APIs", async ({ page }) => {
    await desktop(page);
    await page.getByRole("button", { name: "Open file", exact: true }).click();
    await expect(page.locator(".preview__flow h1")).toHaveText("Native document");
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("# Native edit\n\nKept on disk.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.writes.length)).toBe(1);
    expect(await page.evaluate(() => atob(window.desktopTest.state.writes[0]!.data))).toContain(
        "Kept on disk."
    );
});

test("first native save chooses a destination and subsequent saves reuse it", async ({ page }) => {
    await desktop(page);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("# First native save");
    await page.evaluate(() => {
        window.desktopTest.state.savePaused = true;
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.chooseSaveCount)).toBe(1);
    await page.evaluate(() => window.desktopTest.emit("desktop:before-close"));
    await expect(page.locator(".editor-footer")).toContainText("Wait for the save or backup");
    expect(await page.evaluate(() => window.desktopTest.state.closed)).toBe(false);
    await page.evaluate(() => {
        window.desktopTest.state.savePaused = false;
    });
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.writes.length)).toBe(1);
    await page.getByLabel("Markdown editor").fill("# Second native save");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.writes.length)).toBe(2);
    expect(await page.evaluate(() => window.desktopTest.state.chooseSaveCount)).toBe(1);
    expect(await page.evaluate(() => atob(window.desktopTest.state.writes[1]!.data))).toContain(
        "Second native save"
    );
    await page.evaluate(() => window.desktopTest.emit("desktop:before-close"));
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.closed)).toBe(true);
});

test("native export supports all four formats and reports cancellation", async ({ page }) => {
    await desktop(page);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page
        .getByLabel("Markdown editor")
        .fill(
            "# Desktop export\n\n**Portable** writing and $x^2$.\n\n| A | B |\n| - | - |\n| 1 | 2 |"
        );
    for (const [label, suffix] of [
        ["PDF", "pdf"],
        ["HTML", "html"],
        ["EPUB", "epub"],
        ["Word document", "docx"]
    ] as const) {
        await page.getByRole("button", { name: "Choose export format" }).click();
        await page.getByRole("menuitem", { name: label, exact: true }).click();
        await expect(page.locator(".statusbar")).toContainText(`Saved ${suffix.toUpperCase()}`);
    }
    expect(
        await page.evaluate(() => window.desktopTest.state.writes.map((entry) => entry.name))
    ).toEqual([
        "save:desktop-export.pdf",
        "save:desktop-export.html",
        "save:desktop-export.epub",
        "save:desktop-export.docx"
    ]);
    await page.evaluate(() => {
        window.desktopTest.state.cancelled = true;
    });
    await page.getByRole("button", { name: "Export Word document", exact: true }).click();
    await expect(page.locator(".statusbar")).toContainText("Export cancelled");
});

test("cancelling a native backup leaves the current document intact", async ({ page }) => {
    await desktop(page);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("# Work to keep");
    await page.evaluate(() => {
        window.desktopTest.state.cancelled = true;
    });
    await page.getByRole("button", { name: "New document", exact: true }).click();
    await page.getByRole("button", { name: "Save backup & create" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByLabel("Markdown editor")).toHaveText("# Work to keep");
});

test("native close flushes the last edit, and failed recovery keeps the app open", async ({
    page
}) => {
    await desktop(page);
    await page.getByRole("textbox", { name: "Markdown editor" }).fill("Last desktop sentence.");
    await page.evaluate(() => {
        window.desktopTest.state.recoveryFailed = true;
        window.desktopTest.emit("desktop:before-close");
    });
    await expect(page.locator(".editor-footer")).toContainText("The app stayed open");
    expect(await page.evaluate(() => window.desktopTest.state.closed)).toBe(false);
    await page.evaluate(() => {
        window.desktopTest.state.recoveryFailed = false;
        window.desktopTest.emit("desktop:before-close");
    });
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.closed)).toBe(true);
    expect(
        await page.evaluate(
            () =>
                (JSON.parse(localStorage.getItem("desktop-recovery")!) as { source: string }).source
        )
    ).toContain("Last desktop sentence.");
});

test("native close reflushes edits made while recovery is writing", async ({ page }) => {
    await desktop(page);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByLabel("Markdown editor").fill("# Before closing");
    await page.evaluate(() => {
        window.desktopTest.state.recoveryPaused = true;
        window.desktopTest.state.recoveryStarted = false;
        window.desktopTest.emit("desktop:before-close");
    });
    await expect
        .poll(() => page.evaluate(() => window.desktopTest.state.recoveryStarted))
        .toBe(true);
    await page.getByLabel("Markdown editor").fill("# Final keystrokes while saving");
    await page.evaluate(() => {
        window.desktopTest.state.recoveryPaused = false;
    });
    await expect.poll(() => page.evaluate(() => window.desktopTest.state.closed)).toBe(true);
    expect(
        await page.evaluate(
            () =>
                (JSON.parse(localStorage.getItem("desktop-recovery")!) as { source: string }).source
        )
    ).toContain("Final keystrokes while saving");
});
