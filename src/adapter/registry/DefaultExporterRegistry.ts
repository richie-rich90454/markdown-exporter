import type { ExportFormat } from "../../domain/ExportFormat";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { ExporterRegistry } from "../../port/ExporterRegistry";

export class DefaultExporterRegistry implements ExporterRegistry {
    private readonly exporters = new Map<ExportFormat, DocumentExporter>();

    register(exporter: DocumentExporter): void {
        this.exporters.set(exporter.supportedFormat, exporter);
    }

    lookup(format: ExportFormat): DocumentExporter | undefined {
        return this.exporters.get(format);
    }

    listAvailableFormats(): ExportFormat[] {
        return [...this.exporters.keys()];
    }
}
