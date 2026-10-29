import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserDraftRecovery, chooseLatestRecoveryDraft } from "../../src/adapter/io/LocalDraftRecovery";
import { createSingleChapterBook } from "../../src/domain/BookProject";
import type { RecoveredDraft } from "../../src/port/DraftRecovery";

describe("LocalDraftRecovery", () => {
    afterEach(() => vi.restoreAllMocks());

    beforeEach(() => {
        localStorage.clear();
    });

    it("recovers a local draft after a reload", async () => {
        const source = "# Saved locally\n\nMath: $x^2$.";
        const recovery = new BrowserDraftRecovery();

        await recovery.save(source);
        const recovered = await recovery.load();

        expect(recovered?.source).toBe(source);
        expect(recovered?.savedAt).toBeGreaterThan(0);
    });

    it("recovers a complete book project and its local binary assets", async () => {
        const chapterSource = "+++\ntitle = \"Recovery chapter\"\n+++\n\n# Recovery\n\nText.";
        const base = createSingleChapterBook(chapterSource, "Recovery");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: {
                    ...base.manifest.metadata,
                    authors: ["A. Writer"],
                    subtitle: "Local project",
                    coverPath: "assets/cover.png"
                },
                entries: [
                    ...base.manifest.entries,
                    {
                        id: "front-matter-2",
                        role: "front-matter" as const,
                        path: "front-matter/preface.md",
                        title: "Preface"
                    }
                ],
                bibliographyPath: "references/library.bib",
                citationStylePath: "styles/custom.csl"
            },
            files: {
                ...base.files,
                "front-matter/preface.md": "# Preface\n\nOpening note.",
                "references/library.bib": "@book{local, title={Local source}}",
                "styles/custom.csl": "<style version=\"1.0\"/>",
                "assets/cover.png": new Uint8Array([0, 127, 255])
            }
        };
        const recovery = new BrowserDraftRecovery();
        await recovery.save(chapterSource, project, "front-matter-2");

        const restored = await recovery.load();
        expect(restored?.bookProject?.manifest.metadata.coverPath).toBe("assets/cover.png");
        expect(restored?.bookProject?.manifest.metadata).toMatchObject({
            authors: ["A. Writer"],
            subtitle: "Local project"
        });
        expect(restored?.bookProject?.manifest.bibliographyPath).toBe("references/library.bib");
        expect(restored?.bookProject?.manifest.citationStylePath).toBe("styles/custom.csl");
        expect(restored?.activeEntryId).toBe("front-matter-2");
        expect(restored?.source).toBe(chapterSource);
        expect(restored?.bookProject?.files["front-matter/preface.md"]).toBe("# Preface\n\nOpening note.");
        expect(restored?.bookProject?.files["references/library.bib"]).toContain("@book{local");
        expect(restored?.bookProject?.files["assets/cover.png"]).toEqual(new Uint8Array([0, 127, 255]));
    });

    it("recovers a book project when its active section is intentionally empty", async () => {
        const project = createSingleChapterBook("", "An unfinished chapter");
        const recovery = new BrowserDraftRecovery();

        await recovery.save("", project, project.manifest.entries[0]?.id);
        const restored = await recovery.load();

        expect(restored?.source).toBe("");
        expect(restored?.bookProject?.manifest.metadata.title).toBe("An unfinished chapter");
        expect(restored?.bookProject?.manifest.entries).toHaveLength(1);
        expect(restored?.activeEntryId).toBe("chapter-1");
    });

    it("chooses the newer recovery copy when IndexedDB and localStorage disagree", () => {
        const indexedDbDraft: RecoveredDraft = { source: "Older copy", savedAt: 20 };
        const localDraft: RecoveredDraft = { source: "Newer copy", savedAt: 21 };

        expect(chooseLatestRecoveryDraft(indexedDbDraft, localDraft)).toBe(localDraft);
        expect(chooseLatestRecoveryDraft(localDraft, indexedDbDraft)).toBe(localDraft);
        expect(chooseLatestRecoveryDraft(null, localDraft)).toBe(localDraft);
    });

    it("keeps recovery saves ordered when multiple edits happen in one millisecond", async () => {
        vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
        const recovery = new BrowserDraftRecovery();

        await recovery.save("First edit");
        const first = await recovery.load();
        await recovery.save("Second edit");
        const second = await recovery.load();

        expect(second?.source).toBe("Second edit");
        expect(second?.savedAt).toBeGreaterThan(first?.savedAt ?? 0);
    });

    it("serializes overlapping autosaves in the order the editor requested them", async () => {
        const recovery = new BrowserDraftRecovery();

        await Promise.all([
            recovery.save("First edit"),
            recovery.save("Final edit")
        ]);

        expect((await recovery.load())?.source).toBe("Final edit");
    });
});
