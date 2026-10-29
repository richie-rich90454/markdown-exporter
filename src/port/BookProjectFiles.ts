import type { BookProject } from "../domain/BookProject";
import type { LocalDirectoryHandle } from "./LocalDocuments";

export interface BookProjectFiles {
    readArchive(input: Blob | ArrayBuffer | Uint8Array): Promise<BookProject>;
    writeArchive(project: BookProject): Promise<Uint8Array>;
    readFiles(selectedFiles: readonly File[]): Promise<BookProject | null>;
    readFolder(root: LocalDirectoryHandle): Promise<BookProject | null>;
    writeFolder(root: LocalDirectoryHandle, project: BookProject): Promise<void>;
}
