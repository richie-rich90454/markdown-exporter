import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";

/**
 * Exports through the browser's own print pipeline.
 *
 * No iframe, no srcdoc string and no cloned DOM: the main document is printed,
 * so the export costs nothing beyond the native dialog.
 */
export class PdfExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.PDF;

    constructor(private readonly fileSaver: FileSaver) {}

    export(request: ExportRequest): ReturnType<DocumentExporter["export"]> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`PdfExporter cannot export ${request.format}`);
        }
        this.fileSaver.printCurrentView();
        return ExportResults.success(this.supportedFormat);
    }
}
