/* eslint-disable @typescript-eslint/require-await -- Directory fakes mirror browser Promise APIs. */
import { describe, expect, it } from "vitest";

import { BrowserLocalDocuments } from "../../src/adapter/io/LocalFiles";
import type { LocalDirectoryHandle, LocalFileHandle } from "../../src/port/LocalDocuments";

function fileHandle(name: string, source = "# file"): LocalFileHandle {
    return {
        kind: "file",
        name,
        getFile: () => Promise.resolve(new File([source], name, { type: "text/markdown" })),
        createWritable: () =>
            Promise.resolve({
                write: () => Promise.resolve(),
                close: () => Promise.resolve()
            })
    };
}

describe("LocalFiles", () => {
    it("uses separate file-picker filters for Markdown documents and book archives", async () => {
        const previousPicker = Object.getOwnPropertyDescriptor(window, "showOpenFilePicker");
        const requests: { types?: readonly { accept: Readonly<Record<string, readonly string[]>> }[] }[] = [];
        Object.defineProperty(window, "showOpenFilePicker", {
            configurable: true,
            value: async (options: { types?: readonly { accept: Readonly<Record<string, readonly string[]>> }[] }) => {
                requests.push(options);
                return [];
            }
        });
        try {
            const documents = new BrowserLocalDocuments();
            await documents.pickOpenFile();
            await documents.pickOpenBookFile();

            const markdownExtensions = Object.values(requests[0]?.types?.[0]?.accept ?? {}).flat();
            const bookExtensions = Object.values(requests[1]?.types?.[0]?.accept ?? {}).flat();
            expect(markdownExtensions).toContain(".md");
            expect(markdownExtensions).not.toContain(".mdbook");
            expect(bookExtensions).toEqual([".mdbook"]);
        } finally {
            restoreWindowProperty("showOpenFilePicker", previousPicker);
        }
    });

    it("uses the matching save filter for Markdown documents and book archives", async () => {
        const previousPicker = Object.getOwnPropertyDescriptor(window, "showSaveFilePicker");
        const requests: { suggestedName?: string; types?: readonly { accept: Readonly<Record<string, readonly string[]>> }[] }[] = [];
        Object.defineProperty(window, "showSaveFilePicker", {
            configurable: true,
            value: async (options: { suggestedName?: string; types?: readonly { accept: Readonly<Record<string, readonly string[]>> }[] }) => {
                requests.push(options);
                return fileHandle(options.suggestedName ?? "draft.md");
            }
        });
        try {
            const documents = new BrowserLocalDocuments();
            await documents.pickSaveFile("draft.md");
            await documents.pickSaveFile("book.mdbook");

            const markdownExtensions = Object.values(requests[0]?.types?.[0]?.accept ?? {}).flat();
            const bookExtensions = Object.values(requests[1]?.types?.[0]?.accept ?? {}).flat();
            expect(markdownExtensions).toContain(".md");
            expect(markdownExtensions).not.toContain(".mdbook");
            expect(bookExtensions).toEqual([".mdbook"]);
        } finally {
            restoreWindowProperty("showSaveFilePicker", previousPicker);
        }
    });

    it("lists supported Markdown files through nested local folders", async () => {
        const nested: LocalDirectoryHandle = {
            kind: "directory",
            name: "notes",
            async *values() {
                await Promise.resolve();
                yield fileHandle("nested.markdown");
            },
            getFileHandle: () => Promise.reject(new Error("not used"))
        };
        const root: LocalDirectoryHandle = {
            kind: "directory",
            name: "workspace",
            async *values() {
                await Promise.resolve();
                yield fileHandle("readme.md");
                yield fileHandle("image.png");
                yield nested;
            },
            getFileHandle: () => Promise.reject(new Error("not used"))
        };

        const files = await new BrowserLocalDocuments().listMarkdownFiles(root);

        expect(files.map((entry) => entry.path)).toEqual(["notes/nested.markdown", "readme.md"]);
    });

    it("closes local writable streams after saving", async () => {
        let written: string | Uint8Array | Blob = "";
        let closed = false;
        const handle: LocalFileHandle = {
            kind: "file",
            name: "note.md",
            getFile: () => Promise.reject(new Error("not used")),
            createWritable: () =>
                Promise.resolve({
                    write: (source) => {
                        written = source;
                        return Promise.resolve();
                    },
                    close: () => {
                        closed = true;
                        return Promise.resolve();
                    }
                })
        };

        await new BrowserLocalDocuments().writeFile(handle, "# Saved");

        expect(written).toBe("# Saved");
        expect(closed).toBe(true);
    });
});

function restoreWindowProperty(key: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor === undefined) Reflect.deleteProperty(window, key);
    else Object.defineProperty(window, key, descriptor);
}
