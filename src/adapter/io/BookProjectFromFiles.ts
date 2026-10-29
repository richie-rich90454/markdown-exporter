import {
    assertSafeBookPath,
    canonicalBookPath,
    isBookManifestPath,
    validateBookProject,
    type BookFileData,
    type BookProject
} from "../../domain/BookProject";

const FILE_LIMIT = 64 * 1024 * 1024;
const TOTAL_LIMIT = 256 * 1024 * 1024;
const ENTRY_LIMIT = 10_000;
const MANIFEST_LIMIT = 1024 * 1024;

/** Builds a validated book from a directory input on browsers without folder handles. */
export async function bookProjectFromFiles(selectedFiles: readonly File[]): Promise<BookProject | null> {
    if (selectedFiles.length > ENTRY_LIMIT) throw new Error("The selected folder contains too many files.");
    const root = commonRoot(selectedFiles);
    const files: Record<string, BookFileData> = {};
    const canonicalPaths = new Set<string>();
    let totalSize = 0;
    let manifestText: string | undefined;

    for (const file of selectedFiles) {
        const selectedPath = file.webkitRelativePath || file.name;
        const path = root === undefined ? selectedPath : selectedPath.slice(root.length + 1);
        assertSafeBookPath(path);
        if (file.size > FILE_LIMIT) throw new Error(`The selected file ${path} exceeds the 64 MiB limit.`);
        totalSize += file.size;
        if (totalSize > TOTAL_LIMIT) throw new Error("The selected folder exceeds the 256 MiB size limit.");
        const pathKey = canonicalBookPath(path);
        if (canonicalPaths.has(pathKey)) throw new Error(`The selected folder repeats ${path}.`);
        canonicalPaths.add(pathKey);

        if (isBookManifestPath(path) && file.size > MANIFEST_LIMIT) {
            throw new Error("The book manifest exceeds the 1 MiB limit.");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isBookManifestPath(path)) {
            try {
                manifestText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            } catch {
                throw new Error("The book manifest is not valid UTF-8.");
            }
            continue;
        }
        if (isTextPath(path)) {
            try {
                Object.defineProperty(files, path, {
                    value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                    enumerable: true,
                    configurable: true,
                    writable: true
                });
            } catch {
                throw new Error(`The selected book file ${path} is not valid UTF-8.`);
            }
        } else {
            Object.defineProperty(files, path, {
                value: bytes,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
    }

    if (manifestText === undefined) return null;
    let manifest: unknown;
    try {
        manifest = JSON.parse(manifestText) as unknown;
    } catch {
        throw new Error("The book manifest is not valid JSON.");
    }
    return validateBookProject({ manifest, files });
}

function commonRoot(files: readonly File[]): string | undefined {
    if (files.length === 0) return undefined;
    const firstPath = files[0]?.webkitRelativePath ?? "";
    const firstSeparator = firstPath.indexOf("/");
    if (firstSeparator < 1) return undefined;
    const root = firstPath.slice(0, firstSeparator);
    return files.every((file) => file.webkitRelativePath.startsWith(`${root}/`)) ? root : undefined;
}

function isTextPath(path: string): boolean {
    return /\.(?:md|markdown|mdown|mkd|txt|bib|csl|json|ya?ml|toml|css|html)$/i.test(path);
}
