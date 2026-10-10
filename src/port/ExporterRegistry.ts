import type { ExportFormat } from "../domain/ExportFormat";
import type { DocumentExporter } from "./DocumentExporter";

export interface ExporterRegistry {
    register(exporter: DocumentExporter): void;
    lookup(format: ExportFormat): DocumentExporter | undefined;
    listAvailableFormats(): ExportFormat[];
}
