export interface LocalFileHandle {
    readonly kind: "file";
    readonly name: string;
    getFile(): Promise<File>;
    createWritable(): Promise<LocalFileWritable>;
}

export interface LocalFileWritable {
    write(data: string): Promise<void>;
    close(): Promise<void>;
}

export interface LocalDirectoryHandle {
    readonly kind: "directory";
    readonly name: string;
    values(): AsyncIterable<LocalFileHandle | LocalDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
}

export interface LocalFileEntry {
    readonly path: string;
    readonly file?: File;
    readonly handle?: LocalFileHandle;
}

export interface LocalDocuments {
    pickOpenFile(): Promise<LocalFileHandle | undefined>;
    pickDirectory(): Promise<LocalDirectoryHandle | undefined>;
    pickSaveFile(suggestedName: string): Promise<LocalFileHandle | undefined>;
    listMarkdownFiles(directory: LocalDirectoryHandle): Promise<LocalFileEntry[]>;
    writeFile(handle: LocalFileHandle, source: string): Promise<void>;
}
