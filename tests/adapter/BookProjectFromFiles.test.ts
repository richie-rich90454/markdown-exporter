import { describe, expect, it } from "vitest";

import { bookProjectFromFiles } from "../../src/adapter/io/BookProjectFromFiles";
import { createSingleChapterBook, serializeBookManifest } from "../../src/domain/BookProject";

function folderFile(path: string, data: string | Uint8Array): File {
    const pieces = path.split("/");
    const file = new File(
        [typeof data === "string" ? data : data.slice().buffer],
        pieces.at(-1) ?? path
    );
    Object.defineProperty(file, "webkitRelativePath", { value: `sample-book/${path}` });
    return file;
}

describe("BookProjectFromFiles", () => {
    it("imports a complete book folder from the browser directory picker fallback", async () => {
        const base = createSingleChapterBook("# Chapter\n\nText", "Book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: {
                    ...base.manifest.metadata,
                    authors: ["Writer"],
                    coverPath: "assets/cover.png"
                },
                bibliographyPath: "references/library.bib"
            },
            files: {
                ...base.files,
                "assets/cover.png": new Uint8Array([0, 1, 255]),
                "references/library.bib": "@book{source, title={Local reference}}"
            }
        };
        const selected = [
            folderFile("book.json", serializeBookManifest(project.manifest)),
            folderFile("chapters/chapter-1.md", "# Chapter\n\nText"),
            folderFile("assets/cover.png", new Uint8Array([0, 1, 255])),
            folderFile("references/library.bib", "@book{source, title={Local reference}}")
        ];

        const imported = await bookProjectFromFiles(selected);

        expect(imported?.manifest).toEqual(project.manifest);
        expect(imported?.files["chapters/chapter-1.md"]).toBe("# Chapter\n\nText");
        expect(imported?.files["assets/cover.png"]).toEqual(new Uint8Array([0, 1, 255]));
        expect(imported?.files["references/library.bib"]).toContain("@book{source");
    });

    it("returns null for an ordinary Markdown folder without a book manifest", async () => {
        await expect(
            bookProjectFromFiles([folderFile("notes/chapter.md", "# Notes")])
        ).resolves.toBeNull();
    });

    it("rejects filesystem-equivalent paths rather than silently replacing a book asset", async () => {
        const project = createSingleChapterBook("# Chapter", "Book");
        const duplicateFiles = [
            folderFile("book.json", serializeBookManifest(project.manifest)),
            folderFile("chapters/chapter-1.md", "# Chapter"),
            folderFile("assets/cover.png", "first"),
            folderFile("ASSETS/COVER.PNG", "second")
        ];

        await expect(bookProjectFromFiles(duplicateFiles)).rejects.toThrow(/repeats/i);
    });
});
