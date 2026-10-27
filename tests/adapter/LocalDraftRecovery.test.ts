import { beforeEach, describe, expect, it } from "vitest";

import { BrowserDraftRecovery } from "../../src/adapter/io/LocalDraftRecovery";
import { createSingleChapterBook } from "../../src/domain/BookProject";

describe("LocalDraftRecovery", () => {
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
        const base = createSingleChapterBook("# Recovery\n\nText.", "Recovery");
        const project = {
            ...base,
            manifest: {
                ...base.manifest,
                metadata: { ...base.manifest.metadata, coverPath: "assets/cover.png" }
            },
            files: { ...base.files, "assets/cover.png": new Uint8Array([0, 127, 255]) }
        };
        const recovery = new BrowserDraftRecovery();
        await recovery.save("# Recovery\n\nText.", project, "chapter-1");

        const restored = await recovery.load();
        expect(restored?.bookProject?.manifest.metadata.coverPath).toBe("assets/cover.png");
        expect(restored?.activeEntryId).toBe("chapter-1");
        expect(restored?.bookProject?.files["assets/cover.png"]).toEqual(new Uint8Array([0, 127, 255]));
    });
});
