import {
    assertSafeBookPath,
    canonicalBookPath,
    isBookManifestPath,
    parseBookManifest,
    serializeBookManifest,
    validateBookProject,
    type BookFileData,
    type BookProject
} from "../../domain/BookProject";
import type { LocalDirectoryHandle } from "../../port/LocalDocuments";

const FILE_LIMIT = 64 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;
const ENTRY_LIMIT = 10_000;
const DIRECTORY_DEPTH_LIMIT = 32;

export async function readBookFolder(root: LocalDirectoryHandle): Promise<BookProject | null> {
    const manifestHandle = await root.getFileHandle("book.json").catch((error: unknown) => {
        if (isNotFoundError(error)) return undefined;
        throw error;
    });
    if (manifestHandle === undefined) return null;
    const manifestFile = await manifestHandle.getFile();
    if (manifestFile.size > 1024 * 1024) throw new Error("The book manifest exceeds the 1 MiB limit.");
    const manifestText = await manifestFile.text();
    const files: Record<string, BookFileData> = {};
    let total = 0;
    let count = 0;
    await collectFiles(root, "", files, 0, (size) => {
        count += 1;
        total += size;
        if (count > ENTRY_LIMIT) throw new Error("The book folder contains too many files.");
        if (size > FILE_LIMIT) throw new Error("A book file exceeds the 64 MiB size limit.");
        if (total > TOTAL_LIMIT) throw new Error("The book folder exceeds the 256 MiB size limit.");
    });
    const manifest = parseBookManifest(manifestText, files);
    return validateBookProject({ manifest, files });
}

export async function writeBookFolder(
    root: LocalDirectoryHandle,
    projectValue: BookProject
): Promise<void> {
    const project = validateBookProject(projectValue);
    const entries = Object.entries(project.files);
    let nextTotal = 0;
    if (entries.length + 1 > ENTRY_LIMIT) throw new Error("The book project contains too many files.");
    for (const [path, data] of entries) {
        assertSafeBookPath(path);
        if (isBookManifestPath(path)) throw new Error("A project file cannot replace book.json.");
        const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
        if (size > FILE_LIMIT) throw new Error(`A book file exceeds the 64 MiB size limit: ${path}.`);
        nextTotal += size;
    }
    const manifest = serializeBookManifest(project.manifest);
    const manifestSize = new TextEncoder().encode(manifest).byteLength;
    if (manifestSize > 1024 * 1024) throw new Error("The book manifest exceeds the 1 MiB limit.");
    nextTotal += manifestSize;
    if (nextTotal > TOTAL_LIMIT) throw new Error("The book project exceeds the 256 MiB size limit.");

    const currentPaths = new Set([
        ...Object.keys(project.files),
        ...project.manifest.entries.map((entry) => entry.path)
    ].map(canonicalBookPath));
    const obsoleteEntries = (await readPreviousEntryPaths(root)).filter(
        (path) => !currentPaths.has(canonicalBookPath(path))
    );

    // The File System Access API has no multi-file transaction. Snapshot every target before
    // writing anything, then restore touched files if a later write fails. The manifest remains
    // the final write so readers never see new metadata pointing at old or missing chapters.
    const targets: PreparedTarget[] = [];
    let snapshotBytes = 0;
    const writeEntries: readonly (readonly [string, BookFileData])[] = entries;
    for (const [path, value] of writeEntries) {
        assertSafeBookPath(path);
        const target = await prepareTarget(root, path);
        if (target.previous !== undefined) {
            const limit = path === "book.json" ? 1024 * 1024 : FILE_LIMIT;
            if (target.previous.byteLength > limit) throw new Error(`The existing book file ${path} exceeds the save safety limit.`);
            snapshotBytes += target.previous.byteLength;
            if (snapshotBytes > TOTAL_LIMIT) throw new Error("The existing book folder exceeds the rollback safety limit.");
        } else if (target.directory.removeEntry === undefined) {
            throw new Error(`This browser cannot safely roll back a new book file (${path}); no files were changed.`);
        }
        target.value = value;
        targets.push(target);
    }
    for (const path of obsoleteEntries) {
        assertSafeBookPath(path);
        if (isBookManifestPath(path)) continue;
        const target = await prepareTarget(root, path);
        if (target.previous === undefined) continue;
        if (target.directory.removeEntry === undefined) {
            throw new Error(`This browser cannot safely remove a deleted book section (${path}); no files were changed.`);
        }
        target.operation = "delete";
        targets.push(target);
    }
    const manifestTarget = await prepareTarget(root, "book.json");
    manifestTarget.value = manifest;
    targets.push(manifestTarget);

    const attempted: PreparedTarget[] = [];
    try {
        for (const target of targets) {
            attempted.push(target);
            if (target.operation === "delete") await removePreparedTarget(target);
            else await writePreparedTarget(target, target.value);
        }
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const target of attempted.reverse()) {
            try {
                if (target.previous !== undefined) {
                    await writePreparedTarget(target, target.previous);
                } else {
                    await removePreparedTarget(target);
                }
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                "The book save failed and rollback was incomplete.",
                { cause: error }
            );
        }
        throw error;
    }
}

interface PreparedTarget {
    readonly path: string;
    readonly directory: LocalDirectoryHandle;
    readonly filename: string;
    readonly previous: Uint8Array | undefined;
    value: string | Uint8Array;
    operation: "write" | "delete";
}

async function prepareTarget(root: LocalDirectoryHandle, path: string): Promise<PreparedTarget> {
    const parts = path.split("/");
    const filename = parts.pop();
    if (filename === undefined) throw new Error(`Invalid book path: ${path}.`);
    let directory = root;
    for (const part of parts) {
        if (directory.getDirectoryHandle === undefined) {
            throw new Error("This browser cannot create folders inside the selected book directory.");
        }
        directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const handle = await directory.getFileHandle(filename).catch((error: unknown) => {
        if (isNotFoundError(error)) return undefined;
        throw error;
    });
    if (handle === undefined) {
        return { path, directory, filename, previous: undefined, value: "", operation: "write" };
    }
    const file = await handle.getFile();
    const limit = path === "book.json" ? 1024 * 1024 : FILE_LIMIT;
    if (file.size > limit) throw new Error(`The existing book file ${path} exceeds the save safety limit.`);
    return {
        path,
        directory,
        filename,
        previous: new Uint8Array(await file.arrayBuffer()),
        value: "",
        operation: "write"
    };
}

async function readPreviousEntryPaths(root: LocalDirectoryHandle): Promise<string[]> {
    const handle = await root.getFileHandle("book.json").catch((error: unknown) => {
        if (isNotFoundError(error)) return undefined;
        throw error;
    });
    if (handle === undefined) return [];
    const file = await handle.getFile();
    if (file.size > 1024 * 1024) throw new Error("The existing book manifest exceeds the 1 MiB limit.");
    let manifest: unknown;
    try {
        manifest = JSON.parse(await file.text()) as unknown;
    } catch {
        throw new Error("The existing book manifest is not valid JSON.");
    }
    if (
        typeof manifest !== "object" || manifest === null ||
        !("entries" in manifest) || !Array.isArray(manifest.entries)
    ) throw new Error("The existing book manifest has an invalid section list.");
    const paths = new Set<string>();
    const entries = manifest.entries as unknown[];
    for (const entry of entries) {
        if (typeof entry !== "object" || entry === null || !("path" in entry) || typeof entry.path !== "string") {
            throw new Error("The existing book manifest contains an invalid section path.");
        }
        assertSafeBookPath(entry.path);
        if (!isBookManifestPath(entry.path)) paths.add(entry.path);
    }
    return [...paths];
}

async function writePreparedTarget(target: PreparedTarget, data: string | Uint8Array): Promise<void> {
    const handle = await target.directory.getFileHandle(target.filename, { create: true });
    const writable = await handle.createWritable();
    try {
        await writable.write(data);
        await writable.close();
    } catch (error) {
        try {
            await writable.close();
        } catch {
            // Keep the original write error; the caller will restore the prior file contents.
        }
        throw error;
    }
}

async function removePreparedTarget(target: PreparedTarget): Promise<void> {
    if (target.directory.removeEntry === undefined) {
        throw new Error(`This browser cannot remove the new file ${target.path} during rollback.`);
    }
    await target.directory.removeEntry(target.filename).catch((error: unknown) => {
        if (!isNotFoundError(error)) throw error;
    });
}

async function collectFiles(
    directory: LocalDirectoryHandle,
    prefix: string,
    files: Record<string, BookFileData>,
    depth: number,
    countBytes: (size: number) => void
): Promise<void> {
    if (depth > DIRECTORY_DEPTH_LIMIT) {
        throw new Error(`The book folder exceeds the ${DIRECTORY_DEPTH_LIMIT}-level directory depth limit.`);
    }
    for await (const handle of directory.values()) {
        const path = prefix.length > 0 ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === "directory") {
            assertSafeBookPath(path);
            countBytes(0);
            await collectFiles(handle, path, files, depth + 1, countBytes);
            continue;
        }
        if (isBookManifestPath(path) && prefix.length === 0) continue;
        assertSafeBookPath(path);
        const file = await handle.getFile();
        countBytes(file.size);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const value = isTextPath(path) ? decodeText(bytes, path) : bytes;
        Object.defineProperty(files, path, { value, enumerable: true, configurable: true, writable: true });
    }
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError";
}

function isTextPath(path: string): boolean {
    return /\.(?:md|markdown|mdown|mkd|txt|bib|csl|json|ya?ml|toml|css|html)$/i.test(path);
}

function decodeText(bytes: Uint8Array, path: string): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Error(`The book text file ${path} is not valid UTF-8.`);
    }
}

