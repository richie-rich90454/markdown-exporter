import {
    assertSafeBookPath,
    serializeBookManifest,
    validateBookProject,
    type BookFileData,
    type BookProject
} from "../../domain/BookProject";

const ARCHIVE_LIMIT = 50 * 1024 * 1024;
const FILE_LIMIT = 64 * 1024 * 1024;
const TOTAL_EXPANDED_LIMIT = 256 * 1024 * 1024;
const MANIFEST_LIMIT = 1024 * 1024;
const ENTRY_LIMIT = 10_000;

interface ArchiveEntry {
    readonly path: string;
    readonly compressedSize: number;
    readonly expandedSize: number;
    readonly flags: number;
    readonly externalAttributes: number;
}

export class BookArchiveError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BookArchiveError";
    }
}

/** Encodes the ordinary folder schema as a `.mdbook` ZIP without bundling ZIP code in the app shell. */
export async function encodeBookArchive(projectValue: BookProject): Promise<Uint8Array> {
    const project = validateBookProject(projectValue);
    const { zipSync } = await import("fflate");
    const files: Record<string, Uint8Array> = {
        "book.json": new TextEncoder().encode(serializeBookManifest(project.manifest))
    };
    for (const [path, data] of Object.entries(project.files)) {
        assertArchivePath(path);
        if (path === "book.json") throw new BookArchiveError("A project file cannot replace book.json.");
        files[path] = typeof data === "string" ? new TextEncoder().encode(data) : data;
    }
    try {
        const archive = zipSync(files, { level: 6 });
        if (archive.byteLength > ARCHIVE_LIMIT) {
            throw new BookArchiveError("The book package exceeds the 50 MiB archive limit.");
        }
        return archive;
    } catch (error) {
        if (error instanceof BookArchiveError) throw error;
        throw new BookArchiveError(describeError(error, "The book package could not be created."));
    }
}

/** Decodes a `.mdbook` package in memory and enforces path and expansion limits before extraction. */
export async function decodeBookArchive(input: Blob | ArrayBuffer | Uint8Array): Promise<BookProject> {
    const archive = await toBytes(input);
    if (archive.byteLength > ARCHIVE_LIMIT) {
        throw new BookArchiveError("The book package exceeds the 50 MiB archive limit.");
    }
    const entries = inspectCentralDirectory(archive);
    if (entries.length > ENTRY_LIMIT) throw new BookArchiveError("The package contains too many files.");
    let expandedTotal = 0;
    const paths = new Set<string>();
    for (const entry of entries) {
        assertArchivePath(entry.path);
        if (paths.has(entry.path)) throw new BookArchiveError(`The package repeats ${entry.path}.`);
        paths.add(entry.path);
        if ((entry.flags & 1) !== 0) throw new BookArchiveError("Encrypted book packages are not supported.");
        if (isSymlink(entry.externalAttributes)) {
            throw new BookArchiveError("Book packages cannot contain symbolic links.");
        }
        if (entry.expandedSize > FILE_LIMIT) {
            throw new BookArchiveError(`The package file ${entry.path} exceeds the 64 MiB file limit.`);
        }
        if (entry.path === "book.json" && entry.expandedSize > MANIFEST_LIMIT) {
            throw new BookArchiveError("The book manifest exceeds the 1 MiB limit.");
        }
        expandedTotal += entry.expandedSize;
        if (expandedTotal > TOTAL_EXPANDED_LIMIT) {
            throw new BookArchiveError("The expanded book package exceeds the 256 MiB limit.");
        }
    }
    const { unzipSync } = await import("fflate");
    let unzipped: Record<string, Uint8Array>;
    try {
        unzipped = unzipSync(archive);
    } catch (error) {
        throw new BookArchiveError(describeError(error, "The book package is damaged or unsupported."));
    }
    const manifestBytes = unzipped["book.json"];
    if (manifestBytes === undefined) throw new BookArchiveError("The package is missing book.json.");
    let manifestText: string;
    try {
        manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    } catch {
        throw new BookArchiveError("The book manifest is not valid UTF-8.");
    }
    const files: Record<string, BookFileData> = {};
    for (const [path, data] of Object.entries(unzipped)) {
        if (path === "book.json") continue;
        assertArchivePath(path);
        if (isTextPath(path)) {
            try {
                files[path] = new TextDecoder("utf-8", { fatal: true }).decode(data);
            } catch {
                throw new BookArchiveError(`The package file ${path} is not valid UTF-8.`);
            }
        } else {
            files[path] = data;
        }
    }
    try {
        const manifest = JSON.parse(manifestText) as unknown;
        return validateBookProject({ manifest, files });
    } catch (error) {
        throw new BookArchiveError(describeError(error, "The book manifest or its files are invalid."));
    }
}

function inspectCentralDirectory(bytes: Uint8Array): ArchiveEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lowerBound = Math.max(0, bytes.length - 65_557);
    let endOffset = -1;
    for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) {
            endOffset = offset;
            break;
        }
    }
    if (endOffset < 0) throw new BookArchiveError("The file is not a supported ZIP package.");
    const disk = view.getUint16(endOffset + 4, true);
    const centralDisk = view.getUint16(endOffset + 6, true);
    const diskEntries = view.getUint16(endOffset + 8, true);
    const totalEntries = view.getUint16(endOffset + 10, true);
    const directorySize = view.getUint32(endOffset + 12, true);
    const directoryOffset = view.getUint32(endOffset + 16, true);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
        throw new BookArchiveError("Multi-disk ZIP packages are not supported.");
    }
    if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
        throw new BookArchiveError("ZIP64 book packages are not supported.");
    }
    if (directoryOffset + directorySize > endOffset || totalEntries > ENTRY_LIMIT) {
        throw new BookArchiveError("The ZIP central directory is invalid or too large.");
    }
    const entries: ArchiveEntry[] = [];
    let offset = directoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
        if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
            throw new BookArchiveError("The ZIP central directory is malformed.");
        }
        const flags = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const expandedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const externalAttributes = view.getUint32(offset + 38, true);
        const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
        if (recordEnd > directoryOffset + directorySize) {
            throw new BookArchiveError("The ZIP central directory entry is truncated.");
        }
        const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
        let path: string;
        try {
            path = new TextDecoder("utf-8", { fatal: true }).decode(rawName);
        } catch {
            throw new BookArchiveError("The package contains a file name that is not valid UTF-8.");
        }
        if (!path.endsWith("/")) {
            entries.push({ path, compressedSize, expandedSize, flags, externalAttributes });
        }
        offset = recordEnd;
    }
    return entries;
}

function assertArchivePath(path: string): void {
    try {
        assertSafeBookPath(path);
    } catch {
        throw new BookArchiveError(`Unsafe path in book package: ${path || "(empty)"}.`);
    }
}

function isSymlink(attributes: number): boolean {
    const unixMode = attributes >>> 16;
    return (unixMode & 0xf000) === 0xa000;
}

function isTextPath(path: string): boolean {
    return /\.(?:md|markdown|mdown|mkd|txt|bib|csl|json|ya?ml|toml|css|html)$/i.test(path);
}

async function toBytes(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(await input.arrayBuffer());
}

function describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
