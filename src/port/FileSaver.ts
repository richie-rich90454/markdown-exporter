export interface FileSaver {
    saveBlob(blob: Blob, name: string): void;
    printCurrentView(): void;
}
