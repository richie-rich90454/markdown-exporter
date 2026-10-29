import { zipSync } from "fflate";
import { expect, test } from "@playwright/test";

test("edits the local bibliography and selects a bundled citation style", async ({ page }) => {
    const archive = zipSync({
        "book.json": new TextEncoder().encode(
            JSON.stringify({
                formatVersion: 1,
                metadata: { title: "Reference editing", authors: [], language: "en" },
                entries: [
                    {
                        id: "chapter-one",
                        role: "chapter",
                        path: "chapters/one.md",
                        title: "Chapter One"
                    }
                ],
                bibliographyPath: "references/library.bib"
            })
        ),
        "chapters/one.md": new TextEncoder().encode("An idea [@smith2020]."),
        "references/library.bib": new TextEncoder().encode(
            "@book{smith2020, author={John Smith}, title={A Book}, year={2020}}"
        )
    });
    await page.addInitScript(() => {
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: undefined
        });
    });
    await page.goto("/");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open book" }).click();
    await (
        await chooser
    ).setFiles({
        name: "references.mdbook",
        mimeType: "application/zip",
        buffer: Buffer.from(archive)
    });

    const bookDetails = page.locator(".book-tools__details").filter({ hasText: "Book details" });
    await bookDetails.locator("summary").click();
    const bibliography = bookDetails.getByLabel("Bibliography (BibTeX)");
    await bibliography.fill(
        "@book{smith2020, author={John Smith}, title={A Revised Book}, year={2026}}"
    );
    const style = bookDetails.getByLabel("Reference style");
    await style.selectOption("vancouver");

    await expect(bibliography).toHaveValue(
        "@book{smith2020, author={John Smith}, title={A Revised Book}, year={2026}}"
    );
    await expect(style).toHaveValue("vancouver");
});
