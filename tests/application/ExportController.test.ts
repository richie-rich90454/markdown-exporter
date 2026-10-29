import { describe, expect, it } from "vitest";

import { DefaultExporterRegistry } from "../../src/adapter/registry/DefaultExporterRegistry";
import { ExportController } from "../../src/application/ExportController";
import { ExportFormat } from "../../src/domain/ExportFormat";
import type { PageSetup } from "../../src/domain/PageSetup";
import type { ExportRequest } from "../../src/domain/ExportRequest";
import type { ExportResult } from "../../src/domain/ExportResult";
import { ExportResults } from "../../src/domain/ExportResult";
import { createSingleChapterBook } from "../../src/domain/BookProject";
import { RenderedDocument } from "../../src/domain/RenderedDocument";
import type { DocumentExporter } from "../../src/port/DocumentExporter";
import type { ExporterRegistry } from "../../src/port/ExporterRegistry";

const SETUP: PageSetup = {
    pageSize: "a4",
    marginMm: 20,
    fontFamily: "serif",
    fontSizePt: 11,
    lineHeight: 1.6
};

class ThrowingExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.HTML;

    export(): Promise<ExportResult> {
        return Promise.reject(new Error("disk full"));
    }
}

function rendered(title = "Doc"): RenderedDocument {
    return new RenderedDocument(document.createDocumentFragment(), title, 0);
}

describe("ExportController", () => {
    it("reports failure for an unknown format", async () => {
        const controller = new ExportController(new DefaultExporterRegistry());
        const result = await controller.export(
            ExportFormat.PDF,
            rendered(),
            document.createDocumentFragment(),
            SETUP
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

    it("turns a rejected exporter into a failure result", async () => {
        const registry: ExporterRegistry = {
            register: () => undefined,
            lookup: (format) => (format === ExportFormat.HTML ? new ThrowingExporter() : undefined),
            listAvailableFormats: () => [ExportFormat.HTML]
        };
        const controller = new ExportController(registry);
        const result = await controller.export(
            ExportFormat.HTML,
            rendered(),
            document.createDocumentFragment(),
            SETUP
        );

        expect(result).toEqual({
            kind: "failure",
            format: ExportFormat.HTML,
            message: "disk full"
        });
    });

    it("passes the rendered document and page setup to the exporter", async () => {
        const requests: ExportRequest[] = [];
        const registry: ExporterRegistry = {
            register: () => undefined,
            lookup: (format) =>
                format === ExportFormat.PDF
                    ? {
                          supportedFormat: ExportFormat.PDF,
                          export: (payload) => {
                              requests.push(payload);
                              return Promise.resolve(ExportResults.success(ExportFormat.PDF));
                          }
                      }
                    : undefined,
            listAvailableFormats: () => [ExportFormat.PDF]
        };
        const controller = new ExportController(registry);
        const document = rendered("Report");
        const result = await controller.export(ExportFormat.PDF, document, document.content, SETUP);

        expect(result).toEqual({ kind: "success", format: ExportFormat.PDF });
        expect(requests[0]?.title).toBe("Report");
        expect(requests[0]?.pageSetup).toBe(SETUP);
    });

    it("keeps one-chapter books distinct from single Markdown documents", async () => {
        const requests: ExportRequest[] = [];
        const registry: ExporterRegistry = {
            register: () => undefined,
            lookup: () => ({
                supportedFormat: ExportFormat.HTML,
                export: (payload) => {
                    requests.push(payload);
                    return Promise.resolve(ExportResults.success(ExportFormat.HTML));
                }
            }),
            listAvailableFormats: () => [ExportFormat.HTML]
        };
        const controller = new ExportController(registry);
        const project = createSingleChapterBook("# Chapter heading", "Publication title");
        const document = rendered("Chapter heading");
        const renderSource = () => Promise.resolve(document.content);

        await controller.export(
            ExportFormat.HTML,
            document,
            document.content,
            SETUP,
            project,
            renderSource,
            false
        );
        await controller.export(
            ExportFormat.HTML,
            document,
            document.content,
            SETUP,
            project,
            renderSource,
            true
        );

        expect(requests[0]?.isBookProject).toBe(false);
        expect(requests[0]?.title).toBe("Chapter heading");
        expect(requests[1]?.isBookProject).toBe(true);
        expect(requests[1]?.title).toBe("Publication title");
    });
});
