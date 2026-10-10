import { DefaultExporterRegistry } from "./adapter/registry/DefaultExporterRegistry";
import { BrowserFileSaver } from "./adapter/io/BrowserFileSaver";
import { DirectDomWriter } from "./adapter/renderer/DirectDomWriter";
import { HtmlExporter } from "./adapter/exporter/HtmlExporter";
import { IncrementalMarkdownRenderer } from "./adapter/renderer/IncrementalMarkdownRenderer";
import { PdfExporter } from "./adapter/exporter/PdfExporter";
import { SystemClock } from "./adapter/time/SystemClock";
import { EditorController } from "./application/EditorController";
import { ExportController } from "./application/ExportController";
import { EditorStore } from "./state/EditorStore";
import { ExportStore } from "./state/ExportStore";
import { PreviewStore } from "./state/PreviewStore";
import { SettingsStore } from "./state/SettingsStore";
import type { FileSaver } from "./port/FileSaver";
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
    readonly editorController: EditorControllerType;
    readonly exportController: ExportControllerType;
    readonly fileSaver: FileSaver;
}

export function createApplicationContext(): ApplicationContext {
    const clock = new SystemClock();
    const fileSaver: FileSaver = new BrowserFileSaver();
    const renderer = new IncrementalMarkdownRenderer(new DirectDomWriter(), clock);

    const exporters = new DefaultExporterRegistry();
    exporters.register(new PdfExporter(fileSaver));
    exporters.register(new HtmlExporter(fileSaver));

    return {
        editorStore: new EditorStore(),
        previewStore: new PreviewStore(),
        settingsStore: new SettingsStore(),
        exportStore: new ExportStore(),
        editorController: new EditorController(renderer, clock),
        exportController: new ExportController(exporters),
        fileSaver
    };
}
