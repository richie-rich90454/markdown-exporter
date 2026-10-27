import { describe, expect, it } from "vitest";

import {
    assertSafeBookPath,
    createSingleChapterBook,
    parseBookManifest,
    serializeBookManifest,
    updateBookChapter,
    validateBookProject
} from "../../src/domain/BookProject";

describe("BookProject", () => {
    it("wraps a legacy Markdown document as a single chapter without changing its source", () => {
        const source = "---\ntitle: Old format\n---\n\n# Opening\n\nText.\n";
        const project = createSingleChapterBook(source, "Imported");

        expect(project.manifest.entries).toHaveLength(1);
        expect(project.manifest.entries[0]?.title).toBe("Opening");
        expect(project.files["chapters/chapter-1.md"]).toBe(source);
    });

    it("serializes and validates a manifest with its project files", () => {
        const project = createSingleChapterBook("# Start\n\nChapter body", "My book");
        const manifest = parseBookManifest(serializeBookManifest(project.manifest), project.files);

        expect(manifest).toEqual(project.manifest);
        expect(validateBookProject({ manifest, files: project.files })).toEqual(project);
    });

    it("updates only the requested chapter file", () => {
        const original = createSingleChapterBook("# Start\n\nText", "My book");
        const changed = updateBookChapter(original, "chapter-1", "# Start\n\nRevised");

        expect(changed.files["chapters/chapter-1.md"]).toBe("# Start\n\nRevised");
        expect(original.files["chapters/chapter-1.md"]).toBe("# Start\n\nText");
        expect(changed.manifest).toBe(original.manifest);
    });

    it.each(["../outside.md", "/absolute.md", "C:/drive.md", "assets\\secret.png", "a//b.md"])(
        "rejects unsafe archive path %s",
        (path) => expect(() => assertSafeBookPath(path)).toThrow(/Unsafe path/)
    );

    it("rejects duplicate entries and missing chapter files", () => {
        const project = createSingleChapterBook("# Start", "My book");
        expect(() =>
            validateBookProject({
                ...project,
                manifest: {
                    ...project.manifest,
                    entries: [project.manifest.entries[0], project.manifest.entries[0]]
                }
            })
        ).toThrow(/duplicate entry id/);
        expect(() => validateBookProject({ ...project, files: {} })).toThrow(/file.*missing/i);
    });

    it("rejects manifests that reference an absent cover", () => {
        const project = createSingleChapterBook("# Start", "My book");
        expect(() =>
            validateBookProject({
                ...project,
                manifest: {
                    ...project.manifest,
                    metadata: { ...project.manifest.metadata, coverPath: "assets/cover.png" }
                }
            })
        ).toThrow(/cover image.*missing/i);
    });
});
