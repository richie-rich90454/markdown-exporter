import { createEffect, createSignal, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import type { EditorView } from "@codemirror/view";

import type { ApplicationContext } from "../ApplicationContext";
import type { ExportFormat } from "../domain/ExportFormat";
import type { MarkdownDocument } from "../domain/MarkdownDocument";
import { Debouncer } from "../util/Debouncer";
import { Header } from "./components/Header";
import { PageSetupSheet } from "./components/PageSetupSheet";
import { PreviewPane } from "./components/PreviewPane";
import { ShortcutOverlay } from "./components/ShortcutOverlay";
import { SplitDivider } from "./components/SplitPane";
import { StatusBar } from "./components/StatusBar";

const RENDER_DEBOUNCE_MS = 120;
const ANNOUNCE_IDLE_MS = 1500;
const SPLIT_MIN = 16;
const SPLIT_MAX = 84;
const EditorPane = lazy(() =>
    import("./components/EditorPane").then(({ EditorPane: component }) => ({ default: component }))
);

export interface AppProps {
    context: ApplicationContext;
}

export function App(props: AppProps) {
    const context = props.context;
    const previewStore = context.previewStore;
    const exportStore = context.exportStore;

    const [narrow, setNarrow] = createSignal(false);
    const [stacked, setStacked] = createSignal(false);
    const [pane, setPane] = createSignal<"write" | "preview">("write");
    const [split, setSplit] = createSignal(50);
    const [pageSetupOpen, setPageSetupOpen] = createSignal(false);
    const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
    const [announcement, setAnnouncement] = createSignal("");

    let editorView: EditorView | undefined;
    let previewFlow: HTMLDivElement | undefined;
    let main: HTMLElement | undefined;
    let pendingRevision = -1;
    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    let restoreFocus: HTMLElement | undefined;

    function setEditor(view: EditorView | undefined): void {
        editorView = view;
    }

    function setPreviewFlow(element: HTMLDivElement | undefined): void {
        previewFlow = element;
    }

    const debouncer = new Debouncer(RENDER_DEBOUNCE_MS, () => {
        const document = context.editorStore.current();
        if (document.revision !== pendingRevision) {
            // A newer edit already scheduled its own render.
            return;
        }
        void renderDocument(document);
    });

    onMount(() => {
        const media = window.matchMedia("(max-width: 899px)");
        const applyMedia = (): void => {
            setNarrow(media.matches);
            setStacked(media.matches);
        };
        applyMedia();
        media.addEventListener("change", applyMedia);
        onCleanup(() => media.removeEventListener("change", applyMedia));
        const onKeyDown = (event: KeyboardEvent): void => {
            if (!event.metaKey && !event.ctrlKey) {
                return;
            }
            switch (event.key.toLowerCase()) {
                case "e": {
                    event.preventDefault();
                    void exportActiveFormat(exportStore.activeFormat());
                    break;
                }
                case ",": {
                    event.preventDefault();
                    togglePageSetup();
                    break;
                }
                case "\\": {
                    event.preventDefault();
                    setStacked((current) => !current);
                    break;
                }
                case "/": {
                    event.preventDefault();
                    toggleShortcuts();
                    break;
                }
                default: {
                    break;
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        onCleanup(() => window.removeEventListener("keydown", onKeyDown));

        editorView?.focus();
    });

    createEffect(() => {
        document.documentElement.dataset.theme = context.settingsStore.theme();
    });

    onCleanup(() => {
        debouncer.cancel();
        if (announceTimer !== undefined) {
            clearTimeout(announceTimer);
        }
    });

    function activeElement(): HTMLElement | undefined {
        const element = document.activeElement;
        return element instanceof HTMLElement ? element : undefined;
    }

    function onSourceChange(source: string): void {
        context.editorStore.update(source);
        pendingRevision = context.editorStore.current().revision;
        debouncer.schedule();
    }

    async function renderDocument(document: MarkdownDocument): Promise<void> {
        previewStore.beginRender();
        const startedAt = performance.now();

        let rendered;
        try {
            const previous = previewStore.current();
            rendered =
                previous === null
                    ? await context.editorController.render(document)
                    : await context.editorController.renderIncremental(previous, document);
        } catch (error) {
            if (!superseded(document)) {
                previewStore.fail(describe(error));
            }
            return;
        }

        if (superseded(document)) {
            // The store moved on while the transform ran; the newer render wins.
            return;
        }
        previewStore.setRenderedDocument(rendered, performance.now() - startedAt);
        scheduleAnnouncement();
    }

    function superseded(document: MarkdownDocument): boolean {
        return context.editorStore.current().revision !== document.revision;
    }

    function scheduleAnnouncement(): void {
        if (announceTimer !== undefined) {
            clearTimeout(announceTimer);
        }
        // One polite message after typing settles, never one per keystroke.
        announceTimer = setTimeout(() => {
            setAnnouncement("Preview updated");
        }, ANNOUNCE_IDLE_MS);
    }

    async function exportActiveFormat(format: ExportFormat): Promise<void> {
        const rendered = previewStore.current();
        if (rendered === null || rendered.isEmpty) {
            exportStore.fail("Write some Markdown before exporting.");
            return;
        }
        if (previewFlow === undefined) {
            exportStore.fail("The preview is not ready yet.");
            return;
        }
        exportStore.begin();
        const result = await context.exportController.export(
            format,
            rendered,
            previewFlow,
            context.settingsStore.current()
        );
        exportStore.settle(result);
    }

    function togglePageSetup(): void {
        const wasOpen = pageSetupOpen();
        if (!wasOpen) {
            restoreFocus = activeElement();
        }
        setPageSetupOpen(!wasOpen);
        if (wasOpen) {
            restoreFocus?.focus();
        }
    }

    function toggleShortcuts(): void {
        if (shortcutsOpen()) {
            setShortcutsOpen(false);
            restoreFocus?.focus();
            return;
        }
        restoreFocus = activeElement();
        setShortcutsOpen(true);
    }

    function onDividerKeyDown(event: KeyboardEvent): void {
        const width = main?.clientWidth ?? 0;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const step = (16 / Math.max(width, 1)) * 100;
            const delta = event.key === "ArrowRight" ? step : -step;
            setSplit((current) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, current + delta)));
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            setSplit(25);
        } else if (event.key === "End") {
            event.preventDefault();
            setSplit(75);
        } else if (event.key === "Enter") {
            event.preventDefault();
            setSplit(50);
        }
    }

    return (
        <div class="app" classList={{ "app--stacked": stacked() }}>
            <a class="skip-link" href="#editor">
                Skip to editor
            </a>
            <Header
                context={context}
                showPaneToggle={narrow()}
                paneMode={pane()}
                onTogglePaneMode={() =>
                    setPane((current) => (current === "write" ? "preview" : "write"))
                }
                onOpenPageSetup={() => togglePageSetup()}
                onExport={(format) => void exportActiveFormat(format)}
                onExportActive={() => void exportActiveFormat(exportStore.activeFormat())}
            />
            <main
                class="app__main"
                data-active-pane={pane()}
                style={{ "--split": `${split()}%` }}
                ref={(element) => {
                    main = element;
                }}
            >
                <Suspense
                    fallback={
                        <section class="pane pane--editor editor-loading" aria-label="Editor pane">
                            <span>Loading editor…</span>
                        </section>
                    }
                >
                    <EditorPane context={context} onInput={onSourceChange} editorRef={setEditor} />
                </Suspense>
                <SplitDivider
                    split={split()}
                    onSplitChange={(percent) => setSplit(percent)}
                    onKeyDown={onDividerKeyDown}
                    mainRef={() => main}
                />
                <PreviewPane
                    context={context}
                    flowRef={setPreviewFlow}
                    onFocusEditor={() => editorView?.focus()}
                />
            </main>
            <StatusBar context={context} />
            <Show when={pageSetupOpen()}>
                <PageSetupSheet context={context} onClose={() => togglePageSetup()} />
            </Show>
            <Show when={shortcutsOpen()}>
                <ShortcutOverlay onClose={() => toggleShortcuts()} />
            </Show>
            <div class="sr-only" role="status" aria-live="polite">
                {announcement()}
            </div>
        </div>
    );
}

function describe(error: unknown): string {
    if (!(error instanceof Error)) {
        return "The document could not be rendered.";
    }
    const issue: Record<string, unknown> = { ...error };
    const line = typeof issue.line === "number" ? issue.line : undefined;
    const reason =
        typeof issue.reason === "string" && issue.reason.length > 0 ? issue.reason : error.message;
    const message = reason.length > 0 ? reason : "The document could not be rendered.";
    return line === undefined ? message : `Line ${line}: ${message}`;
}
