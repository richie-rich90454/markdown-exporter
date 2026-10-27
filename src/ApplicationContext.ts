import { DefaultExporterRegistry } from "./adapter/registry/DefaultExporterRegistry";
import { BrowserFileSaver } from "./adapter/io/BrowserFileSaver";
import { BrowserDraftRecovery } from "./adapter/io/LocalDraftRecovery";
import { BrowserLocalDocuments } from "./adapter/io/LocalFiles";
import { BrowserBookProjectFiles } from "./adapter/io/BrowserBookProjectFiles";
import { DeferredDocumentExporter } from "./adapter/exporter/DeferredDocumentExporter";
import { DeferredMarkdownRenderer } from "./adapter/renderer/DeferredMarkdownRenderer";
import { SystemClock } from "./adapter/time/SystemClock";
import { ExportFormat } from "./domain/ExportFormat";
import { EditorController } from "./application/EditorController";
import { ExportController } from "./application/ExportController";
import { EditorStore } from "./state/EditorStore";
import { ExportStore } from "./state/ExportStore";
import { PreviewStore } from "./state/PreviewStore";
import { SettingsStore } from "./state/SettingsStore";
import { BookProjectStore } from "./state/BookProjectStore";
import type { FileSaver } from "./port/FileSaver";
import type { DraftRecovery } from "./port/DraftRecovery";
import type { LocalDocuments } from "./port/LocalDocuments";
import type { BookProjectFiles } from "./port/BookProjectFiles";
import type { EditorController as EditorControllerType } from "./application/EditorController";
import type { ExportController as ExportControllerType } from "./application/ExportController";

/**
 * The single place that knows both the ports and the concrete adapters.
 * Everything is built once and injected through constructors.
 */
export interface ApplicationContext {
    readonly editorStore: EditorStore;
    readonly previewStore: PreviewStore;
    readonly settingsStore: SettingsStore;
    readonly exportStore: ExportStore;
    readonly bookProjectStore: BookProjectStore;
    readonly editorController: EditorControllerType;
    readonly exportController: ExportControllerType;
    readonly fileSaver: FileSaver;
    readonly localDocuments: LocalDocuments;
    readonly bookProjectFiles: BookProjectFiles;
    readonly draftRecovery: DraftRecovery;
}

export function createApplicationContext(): ApplicationContext {
    const clock = new SystemClock();
    const fileSaver: FileSaver = new BrowserFileSaver();
    const renderer = new DeferredMarkdownRenderer(async () => {
        const [{ DirectDomWriter }, { IncrementalMarkdownRenderer }] = await Promise.all([
            import("./adapter/renderer/DirectDomWriter"),
            import("./adapter/renderer/IncrementalMarkdownRenderer")
        ]);
        return new IncrementalMarkdownRenderer(new DirectDomWriter(), clock);
    });

    const exporters = new DefaultExporterRegistry();
    exporters.register(
        new DeferredDocumentExporter(ExportFormat.PDF, async () => {
            const { PdfExporter } = await import("./adapter/exporter/PdfExporter");
            return new PdfExporter(fileSaver);
        })
    );
    exporters.register(
        new DeferredDocumentExporter(ExportFormat.HTML, async () => {
            const { HtmlExporter } = await import("./adapter/exporter/HtmlExporter");
            return new HtmlExporter(fileSaver);
        })
    );
    exporters.register(
        new DeferredDocumentExporter(ExportFormat.EPUB, async () => {
            const { EpubExporter } = await import("./adapter/exporter/EpubExporter");
            return new EpubExporter(fileSaver);
        })
    );
    exporters.register(
        new DeferredDocumentExporter(ExportFormat.DOCX, async () => {
            const { DocxExporter } = await import("./adapter/exporter/DocxExporter");
            return new DocxExporter(fileSaver);
        })
    );

    return {
        editorStore: new EditorStore(),
        previewStore: new PreviewStore(),
        settingsStore: new SettingsStore(),
        exportStore: new ExportStore(),
        bookProjectStore: new BookProjectStore(),
        editorController: new EditorController(renderer, clock),
        exportController: new ExportController(exporters),
        fileSaver,
        localDocuments: new BrowserLocalDocuments(),
        bookProjectFiles: new BrowserBookProjectFiles(),
        draftRecovery: new BrowserDraftRecovery()
    };
}
