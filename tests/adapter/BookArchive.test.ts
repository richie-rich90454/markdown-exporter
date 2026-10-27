import { describe, expect, it } from "vitest";

import { decodeBookArchive, encodeBookArchive } from "../../src/adapter/io/BookArchive";
import { createSingleChapterBook } from "../../src/domain/BookProject";

describe("BookArchive", () => {
    it("round-trips Markdown, metadata, and binary assets through a .mdbook ZIP", async () => {
        const project = {
            ...createSingleChapterBook("# Start\n\nBody", "A book"),
            manifest: {
                ...createSingleChapterBook("# Start\n\nBody", "A book").manifest,
                metadata: {
                    title: "A book",
                    subtitle: "A test project",
                    authors: ["Author"],
                    language: "en"
                }
            },
            files: {
                "chapters/chapter-1.md": "# Start\n\nBody",
                "assets/pixel.png": new Uint8Array([0, 1, 2, 255])
            }
        };

        const restored = await decodeBookArchive(await encodeBookArchive(project));

        expect(restored.manifest).toEqual(project.manifest);
        expect(restored.files["chapters/chapter-1.md"]).toBe("# Start\n\nBody");
        expect(restored.files["assets/pixel.png"]).toEqual(new Uint8Array([0, 1, 2, 255]));
    });

    it("rejects damaged archives", async () => {
        await expect(decodeBookArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow(/ZIP/i);
    });

    it("rejects archives with traversal paths before extraction", async () => {
        const { zipSync } = await import("fflate");
        const archive = zipSync({ "../outside.md": new TextEncoder().encode("bad") });

        await expect(decodeBookArchive(archive)).rejects.toThrow(/Unsafe path/);
    });

    it("rejects a project that contains an invalid file path before packing", async () => {
        const project = {
            ...createSingleChapterBook("# Start", "Book"),
            files: { "../outside.md": "bad" }
        };

        await expect(encodeBookArchive(project)).rejects.toThrow(/Unsafe path/);
    });
});
