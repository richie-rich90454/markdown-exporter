export const BOOK_FORMAT_VERSION = 1 as const;

export type BookEntryRole = "front-matter" | "chapter" | "back-matter";

export interface BookMetadata {
    readonly title: string;
    readonly subtitle?: string;
    readonly authors: readonly string[];
    readonly language: string;
    readonly publisher?: string;
    readonly isbn?: string;
    readonly description?: string;
    readonly coverPath?: string;
}

export interface BookEntry {
    readonly id: string;
    readonly role: BookEntryRole;
    readonly path: string;
    readonly title: string;
}

export interface BookManifest {
    readonly formatVersion: typeof BOOK_FORMAT_VERSION;
    readonly metadata: BookMetadata;
    readonly entries: readonly BookEntry[];
    readonly bibliographyPath?: string;
    readonly citationStylePath?: string;
}

export type BookFileData = string | Uint8Array;

export interface BookProject {
    readonly manifest: BookManifest;
    readonly files: Readonly<Record<string, BookFileData>>;
}

export function createSingleChapterBook(source: string, title = "Untitled manuscript"): BookProject {
    const chapterPath = "chapters/chapter-1.md";
    const entry: BookEntry = {
        id: "chapter-1",
        role: "chapter",
        path: chapterPath,
        title: titleFromSource(source) || title
    };
    const manifest: BookManifest = {
            formatVersion: BOOK_FORMAT_VERSION,
            metadata: { title, authors: [], language: "en" },
            entries: [entry]
        };
    return {
        manifest,
        files: {
            [chapterPath]: source
        }
    };
}

export function validateBookProject(value: unknown): BookProject {
    if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.files)) {
        throw new Error("The book project is missing its manifest or files.");
    }

    const manifest = value.manifest as Partial<BookManifest>;
    if (manifest.formatVersion !== BOOK_FORMAT_VERSION) {
        throw new Error(`Unsupported book format version: ${String(manifest.formatVersion)}.`);
    }
    if (!isRecord(manifest.metadata) || !Array.isArray(manifest.entries)) {
        throw new Error("The book manifest has invalid metadata or entries.");
    }

    const metadata = manifest.metadata as Partial<BookMetadata>;
    if (
        typeof metadata.title !== "string" ||
        !Array.isArray(metadata.authors) ||
        !metadata.authors.every((author) => typeof author === "string") ||
        typeof metadata.language !== "string"
    ) {
        throw new Error("The book metadata must include a title, authors, and language.");
    }
    for (const key of ["subtitle", "publisher", "isbn", "description", "coverPath"] as const) {
        const field = metadata[key];
        if (field !== undefined && typeof field !== "string") {
            throw new Error(`The book metadata field ${key} must be text.`);
        }
    }

    const files: Record<string, BookFileData> = {};
    for (const [path, data] of Object.entries(value.files)) {
        assertSafeBookPath(path);
        if (typeof data === "string") files[path] = data;
        else if (data instanceof Uint8Array) files[path] = data;
        else throw new Error(`The book file ${path} has an unsupported value.`);
    }

    const ids = new Set<string>();
    const entryPaths = new Set<string>();
    if (manifest.entries.length === 0) throw new Error("A book must contain at least one section.");
    const entries = manifest.entries.map((entry, index): BookEntry => {
        if (
            !isRecord(entry) ||
            typeof entry.id !== "string" ||
            typeof entry.title !== "string" ||
            typeof entry.path !== "string" ||
            !isEntryRole(entry.role)
        ) {
            throw new Error(`The book entry at position ${index + 1} is invalid.`);
        }
        if (entry.id.trim().length === 0 || entry.title.trim().length === 0) {
            throw new Error(`The book entry at position ${index + 1} needs an id and title.`);
        }
        if (ids.has(entry.id)) throw new Error(`The book contains a duplicate entry id: ${entry.id}.`);
        ids.add(entry.id);
        assertSafeBookPath(entry.path);
        if (entry.path === "book.json") throw new Error("Book entries cannot replace the manifest.");
        if (entryPaths.has(entry.path)) {
            throw new Error(`The book uses the same Markdown file more than once: ${entry.path}.`);
        }
        entryPaths.add(entry.path);
        if (typeof files[entry.path] !== "string") {
            throw new Error(`The Markdown file for “${entry.title}” is missing.`);
        }
        return { id: entry.id, role: entry.role, path: entry.path, title: entry.title };
    });

    const bibliographyPath = optionalSafePath(manifest.bibliographyPath);
    const citationStylePath = optionalSafePath(manifest.citationStylePath);
    const normalizedManifest: BookManifest = {
        formatVersion: BOOK_FORMAT_VERSION,
        metadata: {
            title: metadata.title,
            authors: [...metadata.authors],
            language: metadata.language,
            ...(typeof metadata.subtitle === "string" ? { subtitle: metadata.subtitle } : {}),
            ...(typeof metadata.publisher === "string" ? { publisher: metadata.publisher } : {}),
            ...(typeof metadata.isbn === "string" ? { isbn: metadata.isbn } : {}),
            ...(typeof metadata.description === "string"
                ? { description: metadata.description }
                : {}),
            ...(typeof metadata.coverPath === "string"
                ? { coverPath: assertAndReturnSafePath(metadata.coverPath) }
                : {})
        },
        entries,
        ...(bibliographyPath === undefined ? {} : { bibliographyPath }),
        ...(citationStylePath === undefined ? {} : { citationStylePath })
    };

    if (
        normalizedManifest.metadata.coverPath !== undefined &&
        files[normalizedManifest.metadata.coverPath] === undefined
    ) {
        throw new Error("The cover image referenced by the book manifest is missing.");
    }
    if (bibliographyPath !== undefined && typeof files[bibliographyPath] !== "string") {
        throw new Error("The bibliography referenced by the book manifest is missing.");
    }
    if (citationStylePath !== undefined && typeof files[citationStylePath] !== "string") {
        throw new Error("The citation style referenced by the book manifest is missing.");
    }

    return { manifest: normalizedManifest, files };
}

export function serializeBookManifest(manifest: BookManifest): string {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseBookManifest(
    serialized: string,
    files: Readonly<Record<string, BookFileData>>
): BookManifest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized) as unknown;
    } catch {
        throw new Error("The book manifest is not valid JSON.");
    }
    return validateBookProject({ manifest: parsed, files }).manifest;
}

export function updateBookChapter(
    project: BookProject,
    entryId: string,
    source: string
): BookProject {
    const entry = project.manifest.entries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) throw new Error(`Unknown book entry: ${entryId}.`);
    return { ...project, files: { ...project.files, [entry.path]: source } };
}

export function titleFromSource(source: string): string {
    for (const line of source.split(/\r?\n/)) {
        const heading = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading?.[1] !== undefined) return heading[1].replace(/\[*\](?:\([^)]*\))?/g, "").trim();
    }
    return "";
}

export function assertSafeBookPath(path: string): void {
    if (
        path.length === 0 ||
        path.includes("\0") ||
        path.includes("\\") ||
        path.startsWith("/") ||
        /^[a-zA-Z]:/.test(path) ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
        throw new Error(`Unsafe path in book project: ${path || "(empty)"}.`);
    }
}

function assertAndReturnSafePath(path: string): string {
    assertSafeBookPath(path);
    return path;
}

function optionalSafePath(path: unknown): string | undefined {
    if (path === undefined) return undefined;
    if (typeof path !== "string") throw new Error("A book file path must be text.");
    return assertAndReturnSafePath(path);
}

function isEntryRole(value: unknown): value is BookEntryRole {
    return value === "front-matter" || value === "chapter" || value === "back-matter";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
