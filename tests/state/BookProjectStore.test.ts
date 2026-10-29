import { afterEach, describe, expect, it, vi } from "vitest";

import { createSingleChapterBook } from "../../src/domain/BookProject";
import * as wordCounter from "../../src/domain/BookWordCount";
import { BookProjectStore } from "../../src/state/BookProjectStore";

afterEach(() => vi.restoreAllMocks());

describe("BookProjectStore", () => {
    it("keeps a standalone Markdown document distinct from a one-section book project", () => {
        const store = new BookProjectStore();
        store.resetToMarkdown("A standalone note.", "Notes");
        expect(store.isBookProject()).toBe(false);

        store.open(createSingleChapterBook("A chapter.", "A book"));
        expect(store.isBookProject()).toBe(true);
    });

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

    it("counts words per chapter and across the manuscript, then reflects replacements", () => {
        const first = createSingleChapterBook("# Opening\n\nA short first chapter.", "Book");
        const project = {
            ...first,
            manifest: {
                ...first.manifest,
                entries: [
                    ...first.manifest.entries,
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/second.md", title: "Second" }
                ]
            },
            files: {
                ...first.files,
                "chapters/second.md": "Two words."
            }
        };
        const store = new BookProjectStore();
        store.open(project);

        expect(store.getChapterWordCount("chapter-1")).toBe(5);
        expect(store.getChapterWordCount("chapter-2")).toBe(2);
        expect(store.getManuscriptWordCount()).toBe(7);
        expect(store.replaceAll("words", "word")).toBe(1);
        expect(store.getManuscriptWordCount()).toBe(7);
        expect(() => store.getChapterWordCount("missing")).toThrow(/Unknown book entry/);
    });

    it("counts manuscript prose while excluding metadata, Markdown syntax, code, and URLs", () => {
        const source = [
            "---",
            'title: "Metadata should not count"',
            "author: A. Writer",
            "---",
            "# **Hello** *world*",
            "A [useful link](https://example.com/a/very/long/destination) and ~~bold~~ text with `const ignored = 1`.",
            "```ts",
            "ignored code words",
            "```",
            "    ignored indented code words",
            "Read this[^source].",
            "",
            "[^source]: Footnote definition should count."
        ].join("\n");
        const store = new BookProjectStore();
        store.open(createSingleChapterBook(source, "Book"));

        expect(store.getChapterWordCount("chapter-1")).toBe(15);
        expect(store.getManuscriptWordCount()).toBe(15);
    });

    it("counts TOML-fronted prose and segments CJK words without whitespace", () => {
        expect(wordCounter.countMarkdownWords([
            "+++",
            'title = "Metadata words do not count"',
            "date = 2026-10-28",
            "+++",
            "你好，世界！ A short sentence."
        ].join("\n"), "zh-CN")).toBe(5);
    });

    it("keeps cached section and manuscript counts current across edits, removals, and reordering", () => {
        const countWords = vi.spyOn(wordCounter, "countMarkdownWords");
        const first = createSingleChapterBook("First words.", "Book");
        const project = {
            ...first,
            manifest: {
                ...first.manifest,
                entries: [
                    ...first.manifest.entries,
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/second.md", title: "Second" },
                    { id: "chapter-3", role: "chapter" as const, path: "chapters/third.md", title: "Third" }
                ]
            },
            files: {
                ...first.files,
                "chapters/second.md": "Second chapter words.",
                "chapters/third.md": "Last."
            }
        };
        const store = new BookProjectStore();
        store.open(project);
        expect(store.getManuscriptWordCount()).toBe(6);
        expect(countWords).toHaveBeenCalledTimes(3);

        store.reorderEntry("chapter-2", 0);
        expect(store.current().manifest.entries[0]?.id).toBe("chapter-2");
        expect(store.getManuscriptWordCount()).toBe(6);
        expect(countWords).toHaveBeenCalledTimes(3);

        store.select("chapter-2");
        store.updateActive("Changed to four clear words.");
        expect(store.getChapterWordCount("chapter-2")).toBe(5);
        expect(store.getManuscriptWordCount()).toBe(8);
        expect(countWords).toHaveBeenCalledTimes(4);

        store.removeEntry("chapter-3");
        expect(store.getManuscriptWordCount()).toBe(7);
        expect(() => store.getChapterWordCount("chapter-3")).toThrow(/Unknown book entry/);
        expect(countWords).toHaveBeenCalledTimes(4);

        store.updateMetadata({ language: "fr" });
        expect(store.getManuscriptWordCount()).toBe(7);
        expect(countWords).toHaveBeenCalledTimes(6);
    });

    it("returns a search excerpt centered on a late match in a long line", () => {
        const before = "A".repeat(300);
        const after = "B".repeat(300);
        const store = new BookProjectStore();
        store.open(createSingleChapterBook(`${before}needle${after}`, "Book"));

        const [match] = store.search("NEEDLE");
        expect(match?.excerpt).toContain("needle");
        expect(match?.excerpt.startsWith("…")).toBe(true);
        expect(match?.excerpt.endsWith("…")).toBe(true);
        expect(match?.excerpt.length).toBeLessThan(300);
        expect(match?.line).toBe(1);
    });

    it("treats replacement text literally across the whole manuscript", () => {
        const first = createSingleChapterBook("$& and $1 and $&", "Book");
        const project = {
            ...first,
            manifest: {
                ...first.manifest,
                entries: [
                    ...first.manifest.entries,
                    { id: "chapter-2", role: "chapter" as const, path: "chapters/second.md", title: "Second" }
                ]
            },
            files: { ...first.files, "chapters/second.md": "Nothing to change here." }
        };
        const store = new BookProjectStore();
        store.open(project);

        expect(store.replaceAll("$&", "[$&]")).toBe(2);
        expect(store.current().files["chapters/chapter-1.md"]).toBe("[$&] and $1 and [$&]");
        expect(store.current().files["chapters/second.md"]).toBe("Nothing to change here.");
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

    it("keeps chapter YAML front matter, book metadata, and local reference files together", () => {
        const chapterSource = "---\ntitle: Source title\nauthor: A Writer\n---\n\n# Opening\n\nFirst draft.";
        const store = new BookProjectStore();
        store.open(createSingleChapterBook(chapterSource, "Project title"));
        const preface = store.addEntry("front-matter", "Preface");
        const appendix = store.addEntry("back-matter", "Appendix");
        store.putFile("references/local.bib", "@book{local, title={Local source}}");
        store.setBibliographyPath("references/local.bib");
        store.putFile("styles/custom.csl", "<style version=\"1.0\"/>");
        store.setCitationStylePath("styles/custom.csl");
        store.updateMetadata({
            title: "Updated project title",
            subtitle: "A subtitle",
            authors: ["A Writer", "B Editor"],
            language: "en-GB"
        });
        store.updateActive(`${chapterSource}\n\nRevised paragraph.`);
        store.select(preface.id);
        store.updateActive("# Preface\n\nOpening note.");
        store.select(appendix.id);
        store.updateActive("# Appendix\n\nSupporting note.");

        const project = store.current();
        expect(project.manifest.entries.map((entry) => entry.role)).toEqual([
            "chapter",
            "front-matter",
            "back-matter"
        ]);
        expect(project.manifest.metadata).toMatchObject({
            title: "Updated project title",
            subtitle: "A subtitle",
            authors: ["A Writer", "B Editor"],
            language: "en-GB"
        });
        expect(project.manifest.bibliographyPath).toBe("references/local.bib");
        expect(project.manifest.citationStylePath).toBe("styles/custom.csl");
        expect(project.files["chapters/chapter-1.md"]).toBe(`${chapterSource}\n\nRevised paragraph.`);
        expect(project.files["references/local.bib"]).toContain("@book{local");
        expect(project.files["styles/custom.csl"]).toContain("<style");
        expect(store.search("opening note").map((match) => match.entryId)).toEqual([preface.id]);
        expect(store.getManuscriptWordCount()).toBe(
            project.manifest.entries.reduce((total, entry) => total + store.getChapterWordCount(entry.id), 0)
        );
    });

    it("rejects an asset path that would invalidate an existing folder layout", () => {
        const project = createSingleChapterBook("# Opening", "Book");
        const store = new BookProjectStore();
        store.open({
            ...project,
            files: { ...project.files, "assets/cover-notes.txt": "Notes" }
        });

        expect(() => store.putFile("assets", "This would be a file and a folder."))
            .toThrow(/conflicts with a folder/i);
        expect(store.current().files.assets).toBeUndefined();
        expect(store.current().files["assets/cover-notes.txt"]).toBe("Notes");
    });

    it("takes ownership of binary assets passed into the project store", () => {
        const store = new BookProjectStore();
        store.open(createSingleChapterBook("# Opening", "Book"));
        const image = new Uint8Array([1, 2, 3]);

        store.putFile("assets/cover.png", image);
        image[0] = 255;

        expect(store.current().files["assets/cover.png"]).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("prevents removing a book's last chapter", () => {
        const store = new BookProjectStore();
        store.open(createSingleChapterBook("# Opening", "Book"));
        expect(() => store.removeEntry("chapter-1")).toThrow("at least one chapter");
    });
});
