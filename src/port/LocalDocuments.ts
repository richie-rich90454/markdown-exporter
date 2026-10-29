export interface LocalFileHandle {
    readonly kind: "file";
    readonly name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<LocalFileWritable>;
}

export interface LocalFileWritable {
    write(data: string | Uint8Array | Blob): Promise<void>;
    close(): Promise<void>;
}

export interface LocalDirectoryHandle {
    readonly kind: "directory";
    readonly name: string;
    values(): AsyncIterable<LocalFileHandle | LocalDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
    getDirectoryHandle?(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
    removeEntry?(name: string): Promise<void>;
}

export interface LocalFileEntry {
    readonly path: string;
    readonly file?: File;
    readonly handle?: LocalFileHandle;
}

export interface LocalDocuments {
    pickOpenFile(): Promise<LocalFileHandle | undefined>;
    pickOpenBookFile(): Promise<LocalFileHandle | undefined>;
    pickDirectory(): Promise<LocalDirectoryHandle | undefined>;
    pickSaveFile(suggestedName: string): Promise<LocalFileHandle | undefined>;
    listMarkdownFiles(directory: LocalDirectoryHandle): Promise<LocalFileEntry[]>;
    writeFile(handle: LocalFileHandle, source: string | Uint8Array | Blob): Promise<void>;
}
