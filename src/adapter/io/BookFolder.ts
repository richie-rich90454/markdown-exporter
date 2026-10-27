import {
    assertSafeBookPath,
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

export async function readBookFolder(root: LocalDirectoryHandle): Promise<BookProject | null> {
    const manifestHandle = await root.getFileHandle("book.json").catch(() => undefined);
    if (manifestHandle === undefined) return null;
    const manifestFile = await manifestHandle.getFile();
    if (manifestFile.size > 1024 * 1024) throw new Error("The book manifest exceeds the 1 MiB limit.");
    const manifestText = await manifestFile.text();
    try {
        void JSON.parse(manifestText) as unknown;
    } catch {
        throw new Error("The book manifest is not valid JSON.");
    }
    const files: Record<string, BookFileData> = {};
    let total = 0;
    let count = 0;
    await collectFiles(root, "", files, (size) => {
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
    await writeFile(root, "book.json", serializeBookManifest(project.manifest));
    for (const [path, data] of Object.entries(project.files)) {
        assertSafeBookPath(path);
        await writeFile(root, path, data);
    }
}

async function collectFiles(
    directory: LocalDirectoryHandle,
    prefix: string,
    files: Record<string, BookFileData>,
    countBytes: (size: number) => void
): Promise<void> {
    for await (const handle of directory.values()) {
        const path = prefix.length > 0 ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === "directory") {
            assertSafeBookPath(path);
            await collectFiles(handle, path, files, countBytes);
            continue;
        }
        if (path === "book.json") continue;
        assertSafeBookPath(path);
        const file = await handle.getFile();
        countBytes(file.size);
        const bytes = new Uint8Array(await file.arrayBuffer());
        files[path] = isTextPath(path) ? decodeText(bytes, path) : bytes;
    }
}

async function writeFile(root: LocalDirectoryHandle, path: string, data: BookFileData): Promise<void> {
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
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    try {
        await writable.write(data);
        await writable.close();
    } catch (error) {
        try {
            await writable.close();
        } catch {
            // Keep the first write error.
        }
        throw error;
    }
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

