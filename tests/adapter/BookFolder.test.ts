/* eslint-disable @typescript-eslint/require-await -- Local File System fakes mirror browser Promise APIs. */
import { describe, expect, it } from "vitest";

import { readBookFolder, writeBookFolder } from "../../src/adapter/io/BookFolder";
import { createSingleChapterBook, serializeBookManifest } from "../../src/domain/BookProject";
import type { LocalDirectoryHandle, LocalFileHandle } from "../../src/port/LocalDocuments";

const FILE_LIMIT = 64 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;

function fileHandle(
    name: string,
    options: { size?: number; text?: string; bytes?: Uint8Array } = {}
): LocalFileHandle {
    const bytes = options.bytes ?? new Uint8Array();
    const fileLike = {
        name,
        size: options.size ?? bytes.byteLength,
        text: async () => options.text ?? "{}",
        arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    } as File;
    return {
        kind: "file",
        name,
        getFile: async () => fileLike,
        createWritable: async () => ({ write: async () => undefined, close: async () => undefined })
    };
}

function readRoot(
    handles: AsyncIterable<LocalFileHandle | LocalDirectoryHandle>,
    manifestText = "{}"
): LocalDirectoryHandle {
    return {
        kind: "directory",
        name: "book",
        values: () => handles,
        getFileHandle: async (name) => {
            if (name === "book.json") return fileHandle(name, { text: manifestText });
            throw Object.assign(new Error("Not found"), { name: "NotFoundError" });
        }
    };
}

function writableDirectory(
    initial: Readonly<Record<string, string | Uint8Array>> = {},
    initialFailure?: string
) {
    const files = new Map<string, Uint8Array>();
    for (const [path, value] of Object.entries(initial)) {
        files.set(
            path,
            typeof value === "string" ? new TextEncoder().encode(value) : value.slice()
        );
    }
    const directories = new Set([""]);
    let failPath = initialFailure;
    const join = (parent: string, name: string) =>
        parent.length === 0 ? name : `${parent}/${name}`;
    const notFound = () => Object.assign(new Error("Not found"), { name: "NotFoundError" });
    const directory = (path: string): LocalDirectoryHandle => ({
        kind: "directory",
        name: path.split("/").at(-1) ?? "book",
        async *values() {},
        getDirectoryHandle: async (name, options) => {
            const child = join(path, name);
            if (!directories.has(child) && options?.create !== true) throw notFound();
            directories.add(child);
            return directory(child);
        },
        removeEntry: async (name) => {
            const target = join(path, name);
            if (!files.delete(target)) throw notFound();
        },
        getFileHandle: async (name, options) => {
            const target = join(path, name);
            if (!files.has(target) && options?.create !== true) throw notFound();
            if (!files.has(target)) files.set(target, new Uint8Array());
            return {
                kind: "file",
                name,
                getFile: async () => {
                    const bytes = files.get(target) ?? new Uint8Array();
                    return {
                        name,
                        size: bytes.byteLength,
                        text: async () => new TextDecoder().decode(bytes),
                        arrayBuffer: async () => bytes.slice().buffer
                    } as File;
                },
                createWritable: async () => {
                    let pending = new Uint8Array();
                    return {
                        write: async (data) => {
                            pending =
                                typeof data === "string"
                                    ? new TextEncoder().encode(data)
                                    : data instanceof Uint8Array
                                      ? data.slice()
                                      : new Uint8Array(await data.arrayBuffer());
                        },
                        close: async () => {
                            files.set(target, pending);
                            if (target === failPath) {
                                failPath = undefined;
                                throw new Error("simulated interrupted write");
                            }
                        }
                    };
                }
            };
        }
    });
    return { root: directory(""), files };
}

function twoChapterProject() {
    const first = createSingleChapterBook("Previous first chapter", "A book");
    const firstEntry = first.manifest.entries[0];
    if (firstEntry === undefined) throw new Error("The fixture needs a first chapter.");
    const secondEntry = {
        id: "chapter-2",
        role: "chapter" as const,
        path: "chapters/chapter-2.md",
        title: "Second chapter"
    };
    return {
        ...first,
        manifest: { ...first.manifest, entries: [firstEntry, secondEntry] },
        files: { ...first.files, [secondEntry.path]: "Previous second chapter" }
    };
}

describe("BookFolder", () => {
    it("propagates folder permission errors instead of treating them as a missing project", async () => {
        const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
        const root: LocalDirectoryHandle = {
            kind: "directory",
            name: "book",
            async *values() {},
            getFileHandle: async () => {
                throw denied;
            }
        };

        await expect(readBookFolder(root)).rejects.toBe(denied);
    });

    it("rejects a folder deeper than the supported directory depth", async () => {
        const nested = (remaining: number, index = 1): LocalDirectoryHandle => ({
            kind: "directory",
            name: `level-${index}`,
            async *values() {
                if (remaining === 1) yield fileHandle("content.md");
                else yield nested(remaining - 1, index + 1);
            },
            getFileHandle: async () => {
                throw new Error("not used");
            }
        });
        const root = readRoot(
            (async function* () {
                yield nested(33);
            })()
        );

        await expect(readBookFolder(root)).rejects.toThrow(/32-level directory depth limit/);
    });

    it("rejects folders containing more than the supported number of entries", async () => {
        const root = readRoot(
            (async function* () {
                for (let index = 0; index < 10_001; index += 1)
                    yield fileHandle(`file-${index}.txt`);
            })()
        );

        await expect(readBookFolder(root)).rejects.toThrow(/too many files/);
    });

    it("does not count empty nested directories against the file limit", async () => {
        const project = createSingleChapterBook("# Opening", "A book");
        const nestedDirectories = (async function* () {
            for (let index = 0; index < 10_001; index += 1) {
                yield {
                    kind: "directory" as const,
                    name: `folder-${index}`,
                    async *values() {},
                    getFileHandle: async () => {
                        throw new Error("not used");
                    }
                };
            }
            yield {
                kind: "directory" as const,
                name: "chapters",
                async *values() {
                    yield fileHandle("chapter-1.md", {
                        text: "# Opening",
                        bytes: new TextEncoder().encode("# Opening")
                    });
                },
                getFileHandle: async () => {
                    throw new Error("not used");
                }
            };
        })();
        const root = readRoot(nestedDirectories, serializeBookManifest(project.manifest));

        await expect(readBookFolder(root)).resolves.toMatchObject({
            manifest: project.manifest,
            files: { "chapters/chapter-1.md": "# Opening" }
        });
    });

    it("enforces individual and aggregate file size limits before reading file bytes", async () => {
        let oversizedBytesRead = false;
        const oversized: LocalFileHandle = {
            ...fileHandle("large.bin", { size: FILE_LIMIT + 1 }),
            getFile: async () =>
                ({
                    name: "large.bin",
                    size: FILE_LIMIT + 1,
                    text: async () => "",
                    arrayBuffer: async () => {
                        oversizedBytesRead = true;
                        return new ArrayBuffer(0);
                    }
                }) as File
        };
        await expect(
            readBookFolder(
                readRoot(
                    (async function* () {
                        yield oversized;
                    })()
                )
            )
        ).rejects.toThrow(/64 MiB/);
        expect(oversizedBytesRead).toBe(false);

        const aggregateRoot = readRoot(
            (async function* () {
                for (let index = 0; index <= Math.floor(TOTAL_LIMIT / FILE_LIMIT); index += 1) {
                    yield fileHandle(`part-${index}.bin`, { size: FILE_LIMIT });
                }
            })()
        );
        await expect(readBookFolder(aggregateRoot)).rejects.toThrow(/256 MiB/);
    });

    it("writes all project content before writing the manifest commit marker", async () => {
        const completedWrites: string[] = [];
        const project = {
            ...createSingleChapterBook("# Opening\n\nBody", "A book"),
            files: {
                "chapters/chapter-1.md": "# Opening\n\nBody",
                "assets/cover.png": new Uint8Array([1, 2, 3])
            }
        };

        const fixture = writableDirectory();
        const trackingDirectory = (
            actual: LocalDirectoryHandle,
            path: string
        ): LocalDirectoryHandle => ({
            ...actual,
            name: path.split("/").at(-1) ?? "book",
            getDirectoryHandle: async (name, options) => {
                if (actual.getDirectoryHandle === undefined)
                    throw new Error("Nested directory access is unavailable.");
                const nested = await actual.getDirectoryHandle(name, options);
                return trackingDirectory(nested, `${path}/${name}`);
            },
            getFileHandle: async (name, options) => {
                const target = `${path}/${name}`;
                const handle = await actual.getFileHandle(name, options);
                return {
                    ...handle,
                    createWritable: async () => {
                        const writable = await handle.createWritable();
                        return {
                            write: (data) => writable.write(data),
                            close: async () => {
                                await writable.close();
                                completedWrites.push(target);
                            }
                        };
                    }
                };
            }
        });
        await writeBookFolder(trackingDirectory(fixture.root, "book"), project);

        expect(completedWrites).toEqual([
            "book/chapters/chapter-1.md",
            "book/assets/cover.png",
            "book/book.json"
        ]);
    });

    it("removes obsolete chapter files after a successful save", async () => {
        const previous = twoChapterProject();
        const fixture = writableDirectory({
            "book.json": serializeBookManifest(previous.manifest),
            ...previous.files
        });
        const first = previous.manifest.entries[0];
        if (first === undefined) throw new Error("The fixture needs a first chapter.");
        const current = {
            ...previous,
            manifest: { ...previous.manifest, entries: [first] },
            files: { [first.path]: "Current chapter" }
        };

        await writeBookFolder(fixture.root, current);

        expect(fixture.files.has("chapters/chapter-2.md")).toBe(false);
        expect(new TextDecoder().decode(fixture.files.get("chapters/chapter-1.md"))).toBe(
            "Current chapter"
        );
    });

    it("restores replaced files, deleted chapters, and the manifest after a late save failure", async () => {
        const previous = twoChapterProject();
        const previousManifest = serializeBookManifest(previous.manifest);
        const fixture = writableDirectory(
            {
                "book.json": previousManifest,
                ...previous.files
            },
            "book.json"
        );
        const first = previous.manifest.entries[0];
        if (first === undefined) throw new Error("The fixture needs a first chapter.");
        const current = {
            ...previous,
            manifest: { ...previous.manifest, entries: [first] },
            files: { [first.path]: "Current chapter" }
        };

        await expect(writeBookFolder(fixture.root, current)).rejects.toThrow(
            "simulated interrupted write"
        );

        expect(new TextDecoder().decode(fixture.files.get("chapters/chapter-1.md"))).toBe(
            "Previous first chapter"
        );
        expect(new TextDecoder().decode(fixture.files.get("chapters/chapter-2.md"))).toBe(
            "Previous second chapter"
        );
        expect(new TextDecoder().decode(fixture.files.get("book.json"))).toBe(previousManifest);
    });
});
