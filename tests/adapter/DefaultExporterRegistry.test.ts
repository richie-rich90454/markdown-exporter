import { describe, expect, it } from "vitest";

import { ExportFormat } from "../../src/domain/ExportFormat";
import { ExportRequest } from "../../src/domain/ExportRequest";
import { ExportResults } from "../../src/domain/ExportResult";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { DocumentExporter } from "../../src/port/DocumentExporter";
import type { ExporterRegistry } from "../../src/port/ExporterRegistry";
import { DefaultExporterRegistry } from "../../src/adapter/registry/DefaultExporterRegistry";

class StubExporter implements DocumentExporter {
    readonly supportedFormat: ExportFormat;
    readonly calls: ExportRequest[] = [];

    constructor(format: ExportFormat) {
        this.supportedFormat = format;
    }

    export(request: ExportRequest): ReturnType<DocumentExporter["export"]> {
        this.calls.push(request);
        return ExportResults.success(this.supportedFormat);
    }
}

function rendered(): RenderedDocument {
    return new RenderedDocument(document.createDocumentFragment(), "title", 0);
}

describe("DefaultExporterRegistry", () => {
    it("dispatches in O(1)", () => {
        const registry: ExporterRegistry = new DefaultExporterRegistry();
        const pdf = new StubExporter(ExportFormat.PDF);
        const html = new StubExporter(ExportFormat.HTML);
        registry.register(pdf);
        registry.register(html);

        expect(registry.lookup(ExportFormat.PDF)).toBe(pdf);
        expect(registry.lookup(ExportFormat.HTML)).toBe(html);
        expect(
            registry
                .lookup(ExportFormat.PDF)
                ?.export(
                    new ExportRequest(
                        ExportFormat.PDF,
                        rendered(),
                        "t",
                        document.createDocumentFragment()
                    )
                )
        ).toEqual({
            kind: "success",
            format: ExportFormat.PDF
        });
        expect(pdf.calls.length).toBe(1);
    });

    it("reports the registered formats", () => {
        const registry = new DefaultExporterRegistry();
        expect(registry.listAvailableFormats()).toEqual([]);
        registry.register(new StubExporter(ExportFormat.PDF));
        expect(registry.listAvailableFormats()).toEqual([ExportFormat.PDF]);
    });

    it("lets a later registration replace an earlier one", () => {
        const registry = new DefaultExporterRegistry();
        const first = new StubExporter(ExportFormat.PDF);
        const second = new StubExporter(ExportFormat.PDF);
        registry.register(first);
        registry.register(second);
        expect(registry.lookup(ExportFormat.PDF)).toBe(second);
        expect(registry.listAvailableFormats()).toEqual([ExportFormat.PDF]);
    });
});
