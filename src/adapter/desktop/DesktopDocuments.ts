import type {
    LocalDirectoryHandle,
    LocalFileHandle,
    LocalFileWritable
} from "../../port/LocalDocuments";
import { BrowserLocalDocuments } from "../io/LocalFiles";
import {
    encodeBlob,
    decodeBytes,
    nativeError,
    selectedEntry,
    type DesktopBridge,
    type NativeEntry
} from "./DesktopBridge";

export class DesktopDocuments extends BrowserLocalDocuments {
    constructor(private readonly bridge: DesktopBridge) {
        super();
    }

    override async pickOpenFile(): Promise<LocalFileHandle> {
        return new DesktopFile(this.bridge, selectedEntry(await this.bridge.ChooseFile(false)));
    }
    override async pickOpenBookFile(): Promise<LocalFileHandle> {
        return new DesktopFile(this.bridge, selectedEntry(await this.bridge.ChooseFile(true)));
    }
    override async pickSaveFile(name: string): Promise<LocalFileHandle> {
        return new DesktopFile(this.bridge, selectedEntry(await this.bridge.ChooseSave(name)));
    }
    override async pickDirectory(): Promise<LocalDirectoryHandle> {
        return new DesktopDirectory(this.bridge, selectedEntry(await this.bridge.ChooseFolder()));
    }
}

class DesktopFile implements LocalFileHandle {
    readonly kind = "file";
    readonly name: string;
    constructor(
        private readonly bridge: DesktopBridge,
        private readonly entry: NativeEntry
    ) {
        this.name = entry.name;
    }
    async getFile(): Promise<File> {
        try {
            const file = await this.bridge.ReadFile(this.entry.id);
            return new File([decodeBytes(file.data)], this.name, { lastModified: file.modified });
        } catch (error) {
            throw nativeError(error);
        }
    }
    createWritable(): Promise<LocalFileWritable> {
        let contents: Blob | undefined;
        let finished = false;
        return Promise.resolve({
            write: (data) => {
                if (finished)
                    return Promise.reject(new Error("This file stream is already closed."));
                contents = data instanceof Blob ? data : new Blob([data as BlobPart]);
                return Promise.resolve();
            },
            close: async () => {
                if (finished) return;
                if (contents !== undefined) {
                    try {
                        await this.bridge.WriteFile(this.entry.id, await encodeBlob(contents));
                    } catch (error) {
                        throw nativeError(error);
                    }
                }
                finished = true;
                contents = undefined;
            },
            abort: () => {
                finished = true;
                contents = undefined;
                return Promise.resolve();
            }
        });
    }
}

class DesktopDirectory implements LocalDirectoryHandle {
    readonly kind = "directory";
    readonly name: string;
    constructor(
        private readonly bridge: DesktopBridge,
        private readonly entry: NativeEntry
    ) {
        this.name = entry.name;
    }
    async *values(): AsyncIterable<LocalFileHandle | LocalDirectoryHandle> {
        const entries = await this.bridge.List(this.entry.id);
        for (const entry of entries)
            yield entry.kind === "directory"
                ? new DesktopDirectory(this.bridge, entry)
                : new DesktopFile(this.bridge, entry);
    }
    async getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle> {
        try {
            return new DesktopFile(
                this.bridge,
                await this.bridge.Child(this.entry.id, name, "file", options?.create ?? false)
            );
        } catch (error) {
            throw nativeError(error);
        }
    }
    async getDirectoryHandle(
        name: string,
        options?: { create?: boolean }
    ): Promise<LocalDirectoryHandle> {
        try {
            return new DesktopDirectory(
                this.bridge,
                await this.bridge.Child(this.entry.id, name, "directory", options?.create ?? false)
            );
        } catch (error) {
            throw nativeError(error);
        }
    }
    async removeEntry(name: string): Promise<void> {
        try {
            await this.bridge.RemoveFile(this.entry.id, name);
        } catch (error) {
            throw nativeError(error);
        }
    }
}
