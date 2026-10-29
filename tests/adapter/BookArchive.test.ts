import { describe, expect, it } from "vitest";

import { decodeBookArchive, encodeBookArchive } from "../../src/adapter/io/BookArchive";
import { createSingleChapterBook, serializeBookManifest } from "../../src/domain/BookProject";

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

    it("checks a selected archive's size before reading its bytes", async () => {
        const oversized = {
            size: 50 * 1024 * 1024 + 1,
            arrayBuffer: () => {
                throw new Error("The archive should not be read.");
            }
        } as unknown as Blob;

        await expect(decodeBookArchive(oversized)).rejects.toThrow(/50 MiB archive limit/i);
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

    it("rejects the one filename the ZIP reader cannot represent without loss", async () => {
        const base = createSingleChapterBook("# Opening", "Book");
        const files = { ...base.files };
        Object.defineProperty(files, "__proto__", {
            value: "Preserve this note",
            enumerable: true,
            configurable: true,
            writable: true
        });

        await expect(encodeBookArchive({ ...base, files })).rejects.toThrow(/cannot be represented safely/i);
    });

    it("enforces the manifest size limit when creating a package", async () => {
        const project = createSingleChapterBook("# Opening", "B".repeat(1024 * 1024));

        await expect(encodeBookArchive(project)).rejects.toThrow(/manifest exceeds the 1 MiB limit/i);
    });

    it("enforces the package entry limit when creating a package", async () => {
        const project = createSingleChapterBook("# Opening", "Book");
        const files = { ...project.files };
        for (let index = 0; index < 9_999; index += 1) {
            files[`assets/item-${index}.txt`] = "";
        }

        await expect(encodeBookArchive({ ...project, files })).rejects.toThrow(/too many files/i);
    });

    it("rejects an archive that declares a file larger than the expanded file limit", async () => {
        const project = createSingleChapterBook("# Opening", "Book");
        const archive = setExpandedSizes(
            await encodeBookArchive(project),
            { "chapters/chapter-1.md": 64 * 1024 * 1024 + 1 }
        );

        await expect(decodeBookArchive(archive)).rejects.toThrow(/exceeds the 64 MiB file limit/i);
    });

    it("rejects an archive that declares an expanded project above the package limit", async () => {
        const base = createSingleChapterBook("# Opening", "Book");
        const project = {
            ...base,
            files: {
                ...base.files,
                "assets/one.bin": new Uint8Array(),
                "assets/two.bin": new Uint8Array(),
                "assets/three.bin": new Uint8Array(),
                "assets/four.bin": new Uint8Array()
            }
        };
        const expanded = 60 * 1024 * 1024;
        const archive = setExpandedSizes(await encodeBookArchive(project), {
            "chapters/chapter-1.md": expanded,
            "assets/one.bin": expanded,
            "assets/two.bin": expanded,
            "assets/three.bin": expanded,
            "assets/four.bin": expanded
        });

        await expect(decodeBookArchive(archive)).rejects.toThrow(/expanded book package exceeds the 256 MiB limit/i);
    });

    it("rejects filesystem-equivalent archive names before extracting them", async () => {
        const { zipSync } = await import("fflate");
        const project = createSingleChapterBook("# Opening", "Book");
        const archive = zipSync({
            "book.json": new TextEncoder().encode(serializeBookManifest(project.manifest)),
            "BOOK.JSON": new TextEncoder().encode("not the manifest")
        });

        await expect(decodeBookArchive(archive)).rejects.toThrow(/filesystem-equivalent path/i);
    });

    it("rejects ZIP records whose local path disagrees with the central directory", async () => {
        const project = createSingleChapterBook("# Opening", "Book");
        const archive = await encodeBookArchive(project);
        // The first local record is book.json, whose name begins after the 30-byte fixed header.
        archive[30] = "B".charCodeAt(0);

        await expect(decodeBookArchive(archive)).rejects.toThrow(/mismatched local and central paths/i);
    });
});

function setExpandedSizes(archive: Uint8Array, sizes: Readonly<Record<string, number>>): Uint8Array {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const endOffset = archive.length - 22;
    const centralOffset = view.getUint32(endOffset + 16, true);
    const entryCount = view.getUint16(endOffset + 10, true);
    let entryOffset = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
        const nameLength = view.getUint16(entryOffset + 28, true);
        const extraLength = view.getUint16(entryOffset + 30, true);
        const commentLength = view.getUint16(entryOffset + 32, true);
        const nameStart = entryOffset + 46;
        const path = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength));
        const size = sizes[path];
        if (size !== undefined) view.setUint32(entryOffset + 24, size, true);
        entryOffset += 46 + nameLength + extraLength + commentLength;
    }
    return archive;
}
