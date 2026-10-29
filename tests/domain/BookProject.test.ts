import { describe, expect, it } from "vitest";

import {
    assertSafeBookPath,
    createSingleChapterBook,
    parseBookManifest,
    serializeBookManifest,
    updateBookChapter,
    validateBookProject
} from "../../src/domain/BookProject";
import { cloneBookProject, sameBookProject } from "../../src/domain/BookProjectSnapshot";

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

    it.each(["CON.md", "assets/bad?.png", "notes/trailing.", "docs/with:colon.md"])(
        "rejects paths that cannot be represented safely on common filesystems: %s",
        (path) => expect(() => assertSafeBookPath(path)).toThrow(/Unsafe path/)
    );

    it("rejects case-insensitive and Unicode-normalized file path collisions", () => {
        const project = createSingleChapterBook("# Start", "My book");
        expect(() => validateBookProject({
            ...project,
            files: { ...project.files, "CHAPTERS/CHAPTER-1.MD": "duplicate" }
        })).toThrow(/collide on common filesystems/);
        expect(() => validateBookProject({
            ...project,
            files: { ...project.files, "caf\u00e9.txt": "one", "cafe\u0301.txt": "two" }
        })).toThrow(/collide on common filesystems/);
    });

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

    it("rejects project files that overwrite the manifest or collide with a folder path", () => {
        const project = createSingleChapterBook("# Start", "My book");
        expect(() => validateBookProject({
            ...project,
            files: { ...project.files, "BOOK.JSON": "not the manifest" }
        })).toThrow(/book\.json manifest/i);
        expect(() => validateBookProject({
            ...project,
            files: { ...project.files, assets: "a file", "assets/cover.png": new Uint8Array([1]) }
        })).toThrow(/conflicts with the file/);
    });

    it("rejects section and resource paths that point to the same file", () => {
        const project = createSingleChapterBook("# Start", "My book");
        const chapterPath = project.manifest.entries[0]?.path ?? "";
        expect(() => validateBookProject({
            ...project,
            manifest: {
                ...project.manifest,
                metadata: { ...project.manifest.metadata, coverPath: chapterPath }
            }
        })).toThrow(/cover path .* conflicts with section/i);

        const withReferences = {
            ...project,
            manifest: {
                ...project.manifest,
                bibliographyPath: "references/library.bib",
                citationStylePath: "references/library.bib"
            },
            files: { ...project.files, "references/library.bib": "@book{key}" }
        };
        expect(() => validateBookProject(withReferences)).toThrow(/citation style path .* conflicts with bibliography/i);
    });

    it("requires at least one chapter in an otherwise valid book", () => {
        const project = createSingleChapterBook("Preface", "My book");
        expect(() => validateBookProject({
            ...project,
            manifest: {
                ...project.manifest,
                entries: [{ ...project.manifest.entries[0]!, role: "front-matter" as const }]
            }
        })).toThrow(/at least one chapter/);
    });

    it("compares complete project snapshots and detaches binary assets", () => {
        const project = {
            ...createSingleChapterBook("---\ntitle: Kept\n---\n\n# Chapter", "A book"),
            manifest: {
                ...createSingleChapterBook("# Chapter", "A book").manifest,
                bibliographyPath: "references/library.bib"
            },
            files: {
                "chapters/chapter-1.md": "---\ntitle: Kept\n---\n\n# Chapter",
                "references/library.bib": "@book{local}",
                "assets/cover.png": new Uint8Array([0, 127, 255])
            }
        };
        const snapshot = cloneBookProject(project);

        expect(sameBookProject(snapshot, project)).toBe(true);
        (project.files["assets/cover.png"] as Uint8Array)[0] = 42;
        expect(sameBookProject(snapshot, project)).toBe(false);
        expect(snapshot.files["assets/cover.png"]).toEqual(new Uint8Array([0, 127, 255]));
        expect(sameBookProject(snapshot, {
            ...snapshot,
            files: { ...snapshot.files, "references/library.bib": "@book{changed}" }
        })).toBe(false);
    });
});
