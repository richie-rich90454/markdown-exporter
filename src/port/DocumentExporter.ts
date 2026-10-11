import type { ExportFormat } from "../domain/ExportFormat";
import type { ExportRequest } from "../domain/ExportRequest";
import type { ExportResult } from "../domain/ExportResult";

export interface DocumentExporter {
    readonly supportedFormat: ExportFormat;
    export(request: ExportRequest): Promise<ExportResult>;
}
