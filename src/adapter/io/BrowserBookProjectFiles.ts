import { decodeBookArchive, encodeBookArchive } from "./BookArchive";
import { readBookFolder, writeBookFolder } from "./BookFolder";
import { bookProjectFromFiles } from "./BookProjectFromFiles";
import type { BookProjectFiles } from "../../port/BookProjectFiles";

export class BrowserBookProjectFiles implements BookProjectFiles {
    readArchive(input: Blob | ArrayBuffer | Uint8Array) {
        return decodeBookArchive(input);
    }

    writeArchive(project: Parameters<BookProjectFiles["writeArchive"]>[0]) {
        return encodeBookArchive(project);
    }

    readFiles(selectedFiles: Parameters<BookProjectFiles["readFiles"]>[0]) {
        return bookProjectFromFiles(selectedFiles);
    }

    readFolder(root: Parameters<BookProjectFiles["readFolder"]>[0]) {
        return readBookFolder(root);
    }

    writeFolder(root: Parameters<BookProjectFiles["writeFolder"]>[0], project: Parameters<BookProjectFiles["writeFolder"]>[1]) {
        return writeBookFolder(root, project);
    }
}
