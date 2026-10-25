import type { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";

export class DeferredDocumentExporter implements DocumentExporter {
    private exporterPromise: Promise<DocumentExporter> | undefined;

    constructor(
        readonly supportedFormat: ExportFormat,
        private readonly loadExporter: () => Promise<DocumentExporter>
    ) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        this.exporterPromise ??= this.loadExporter();
        return (await this.exporterPromise).export(request);
    }
}
