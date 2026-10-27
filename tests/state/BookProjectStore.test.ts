import { describe, expect, it } from "vitest";

import { createSingleChapterBook } from "../../src/domain/BookProject";
import { BookProjectStore } from "../../src/state/BookProjectStore";

describe("BookProjectStore", () => {
    it("searches and replaces across chapter files without touching other files", () => {
        const base = createSingleChapterBook("# Start\n\nSame word.", "Book");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                entries: [
                    ...base.manifest.entries,
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/second.md", title: "Second" }
                ]
            },
            files: {
                ...base.files,
                "chapters/second.md": "Same again.\n\nUnchanged."
            }
        };
        const store = new BookProjectStore();
        store.open(project);

        expect(store.search("same").map((match) => match.path)).toEqual([
            "chapters/chapter-1.md",
            "chapters/second.md"
        ]);
        expect(store.replaceAll("same", "new")).toBe(2);
        expect(store.current().files["chapters/chapter-1.md"]).toBe("# Start\n\nnew word.");
        expect(store.current().files["chapters/second.md"]).toBe("new again.\n\nUnchanged.");
    });

    it("updates project metadata and returns chapter source when navigating", () => {
        const base = createSingleChapterBook("# Start", "Book");
        const store = new BookProjectStore();
        store.open(base);
        store.updateMetadata({ authors: ["A. Writer"], language: "en-GB" });

        expect(store.current().manifest.metadata.authors).toEqual(["A. Writer"]);
        expect(store.select("chapter-1").source).toBe("# Start");
    });

    it("adds front matter and chapters in project order with editable titles", () => {
        const store = new BookProjectStore();
        store.open(createSingleChapterBook("# Opening", "Book"));

        const preface = store.addEntry("front-matter", "Preface");
        const chapter = store.addEntry("chapter", "Next chapter");
        store.renameEntry(chapter.id, "A revised chapter");
        store.reorderEntry(chapter.id, 0);

        expect(store.current().manifest.entries.map((entry) => entry.id)).toEqual([
            chapter.id,
            "chapter-1",
            preface.id
        ]);
        expect(store.current().manifest.entries[0]?.title).toBe("A revised chapter");
        expect(store.current().files["chapters/next-chapter.md"]).toBe("# Next chapter\n\n");
    });

    it("prevents removing a book's last chapter", () => {
        const store = new BookProjectStore();
        store.open(createSingleChapterBook("# Opening", "Book"));
        expect(() => store.removeEntry("chapter-1")).toThrow("at least one chapter");
    });
});
