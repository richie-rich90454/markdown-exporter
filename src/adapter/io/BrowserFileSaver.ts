import type { FileSaver } from "../../port/FileSaver";

export class BrowserFileSaver implements FileSaver {
    saveBlob(blob: Blob, name: string): void {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        anchor.rel = "noopener";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // Revoking synchronously can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
