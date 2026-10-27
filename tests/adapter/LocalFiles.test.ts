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
