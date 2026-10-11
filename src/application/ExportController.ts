import type { ExportFormat } from "../domain/ExportFormat";
import { EXPORT_FORMAT_LABELS } from "../domain/ExportFormat";
import { ExportRequest } from "../domain/ExportRequest";
import type { ExportResult } from "../domain/ExportResult";
import { ExportResults } from "../domain/ExportResult";
import type { RenderedDocument } from "../domain/RenderedDocument";
import type { PageSetup } from "../domain/PageSetup";
import type { ExporterRegistry } from "../port/ExporterRegistry";

export class ExportController {
    constructor(private readonly registry: ExporterRegistry) {}

    availableFormats(): ExportFormat[] {
        return this.registry.listAvailableFormats();
    }

    async export(
        format: ExportFormat,
        rendered: RenderedDocument,
        content: Node,
        pageSetup: PageSetup
    ): Promise<ExportResult> {
        const exporter = this.registry.lookup(format);
        if (exporter === undefined) {
            const label = EXPORT_FORMAT_LABELS[format];
            return ExportResults.failure(format, `No exporter is registered for ${label}.`);
        }
        const request = new ExportRequest(format, rendered, rendered.title, content, pageSetup);
        try {
            return await exporter.export(request);
        } catch (error) {
            return ExportResults.failure(format, describe(error));
        }
    }
}

function describe(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }
    return "The export failed.";
}
