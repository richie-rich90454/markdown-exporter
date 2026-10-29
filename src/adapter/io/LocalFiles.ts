import type {
    LocalDirectoryHandle,
    LocalDocuments,
    LocalFileEntry,
    LocalFileHandle
} from "../../port/LocalDocuments";

interface LocalFilePickerOptions {
    readonly description: string;
    readonly accept: Readonly<Record<string, readonly string[]>>;
}

declare global {
    interface Window {
        showOpenFilePicker?(options?: {
            multiple?: boolean;
            types?: readonly LocalFilePickerOptions[];
        }): Promise<LocalFileHandle[]>;
        showSaveFilePicker?(options?: {
            suggestedName?: string;
            types?: readonly LocalFilePickerOptions[];
        }): Promise<LocalFileHandle>;
        showDirectoryPicker?(options?: {
            mode?: "read" | "readwrite";
        }): Promise<LocalDirectoryHandle>;
    }
}

const markdownFileTypes: readonly LocalFilePickerOptions[] = [
    {
        description: "Markdown document",
        accept: {
            "text/markdown": [".md", ".markdown", ".mdown", ".mkd"],
            "text/plain": [".txt"]
        }
    }
];
const bookFileTypes: readonly LocalFilePickerOptions[] = [
    { description: "Markdown book project", accept: { "application/zip": [".mdbook"] } }
];

export class BrowserLocalDocuments implements LocalDocuments {
    async pickOpenFile(): Promise<LocalFileHandle | undefined> {
        if (window.showOpenFilePicker === undefined) return undefined;
        const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: markdownFileTypes
        });
        return handle;
    }

    async pickOpenBookFile(): Promise<LocalFileHandle | undefined> {
        if (window.showOpenFilePicker === undefined) return undefined;
        const [handle] = await window.showOpenFilePicker({
            multiple: false,
            types: bookFileTypes
        });
        return handle;
    }

    async pickDirectory(): Promise<LocalDirectoryHandle | undefined> {
        if (window.showDirectoryPicker === undefined) return undefined;
        return window.showDirectoryPicker({ mode: "readwrite" });
    }

    async pickSaveFile(suggestedName: string): Promise<LocalFileHandle | undefined> {
        if (window.showSaveFilePicker === undefined) return undefined;
        const types = /\.mdbook$/i.test(suggestedName) ? bookFileTypes : markdownFileTypes;
        return window.showSaveFilePicker({ suggestedName, types });
    }

    async listMarkdownFiles(directory: LocalDirectoryHandle): Promise<LocalFileEntry[]> {
        return listMarkdownFiles(directory);
    }

    async writeFile(handle: LocalFileHandle, source: string | Uint8Array | Blob): Promise<void> {
        const writable = await handle.createWritable();
        try {
            await writable.write(source);
            await writable.close();
        } catch (error) {
            try {
                await writable.close();
            } catch {
                // Keep the original write error as the useful failure.
            }
            throw error;
        }
    }
}

async function listMarkdownFiles(
    directory: LocalDirectoryHandle,
    prefix = "",
    depth = 0,
    limit = 1000
): Promise<LocalFileEntry[]> {
    const files: LocalFileEntry[] = [];
    if (depth > 8 || limit <= 0) return files;
    for await (const handle of directory.values()) {
        if (files.length >= limit) break;
        const path = prefix.length > 0 ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === "directory") {
            files.push(...(await listMarkdownFiles(handle, path, depth + 1, limit - files.length)));
        } else if (/\.(?:md|markdown|mdown|mkd|txt)$/i.test(handle.name)) {
            files.push({ path, handle });
        }
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
}
