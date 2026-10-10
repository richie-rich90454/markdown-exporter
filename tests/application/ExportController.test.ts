import { describe, expect, it } from "vitest";

import { DefaultExporterRegistry } from "../../src/adapter/registry/DefaultExporterRegistry";
import { ExportController } from "../../src/application/ExportController";
import { ExportFormat } from "../../src/domain/ExportFormat";
import type { ExportRequest } from "../../src/domain/ExportRequest";
import { ExportResults } from "../../src/domain/ExportResult";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { DocumentExporter } from "../../src/port/DocumentExporter";
import type { ExporterRegistry } from "../../src/port/ExporterRegistry";

class ThrowingExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.HTML;

    export(): ReturnType<DocumentExporter["export"]> {
        throw new Error("disk full");
    }
}

function rendered(title = "Doc"): RenderedDocument {
    return new RenderedDocument(document.createDocumentFragment(), title, 0);
}

describe("ExportController", () => {
    it("reports failure for an unknown format", () => {
        const controller = new ExportController(new DefaultExporterRegistry());
        const result = controller.export(
            ExportFormat.PDF,
            rendered(),
            document.createDocumentFragment()
        );

        expect(result).toEqual({
            kind: "failure",
            format: ExportFormat.PDF,
            message: "No exporter is registered for PDF."
        });
    });

    it("lists the available formats", () => {
        const registry = new DefaultExporterRegistry();
        registry.register(new ThrowingExporter());
        const controller = new ExportController(registry);

        expect(controller.availableFormats()).toEqual([ExportFormat.HTML]);
    });

    it("turns a thrown exporter error into a failure result", () => {
        const registry: ExporterRegistry = {
            register: () => undefined,
            lookup: (format) => (format === ExportFormat.HTML ? new ThrowingExporter() : undefined),
            listAvailableFormats: () => [ExportFormat.HTML]
        };
        const controller = new ExportController(registry);
        const result = controller.export(
            ExportFormat.HTML,
            rendered(),
            document.createDocumentFragment()
        );

        expect(result).toEqual({
            kind: "failure",
            format: ExportFormat.HTML,
            message: "disk full"
        });
    });

    it("passes the rendered document through to the exporter", () => {
        const requests: ExportRequest[] = [];
        const registry: ExporterRegistry = {
            register: () => undefined,
            lookup: (format) =>
                format === ExportFormat.PDF
                    ? {
                          supportedFormat: ExportFormat.PDF,
                          export: (payload) => {
                              requests.push(payload);
                              return ExportResults.success(ExportFormat.PDF);
                          }
                      }
                    : undefined,
            listAvailableFormats: () => [ExportFormat.PDF]
        };
        const controller = new ExportController(registry);
        const document = rendered("Report");
        const result = controller.export(ExportFormat.PDF, document, document.content);

        expect(result).toEqual({ kind: "success", format: ExportFormat.PDF });
        expect(requests[0]?.title).toBe("Report");
    });
});
