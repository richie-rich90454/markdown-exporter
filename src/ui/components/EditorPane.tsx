import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
    Compartment,
    EditorState,
    RangeSet,
    StateEffect,
    StateField,
    type Extension,
    type Range
} from "@codemirror/state";
import {
    Decoration,
    EditorView,
    ViewPlugin,
    keymap,
    type DecorationSet,
    type ViewUpdate,
    WidgetType
} from "@codemirror/view";
import { searchKeymap } from "@codemirror/search";
import type katex from "katex";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { tags } from "@lezer/highlight";

import type { ApplicationContext } from "../../ApplicationContext";
import { PHYSICS_MACROS } from "../../domain/KatexMacros";
import { findPandocTexSequences, hasPandocTex, normalizeTexFormula } from "../../domain/PandocTex";
import type {
    LocalDirectoryHandle,
    LocalFileEntry,
    LocalFileHandle
} from "../../port/LocalDocuments";

type EditorMode = "source" | "inline";
type KatexApi = typeof katex;

export interface EditorPaneProps {
    context: ApplicationContext;
    onInput: (value: string) => void;
    editorRef: (view: EditorView | undefined) => void;
}

let katexApi: KatexApi | undefined;
let katexLoad: Promise<void> | undefined;
let katexChemistryLoad: Promise<unknown> | undefined;
let katexVersion = 0;
const refreshInlineDecorations = StateEffect.define<void>();
const refreshMathDecorations = StateEffect.define<void>();
const setMathDecorations = StateEffect.define<DecorationSet>();
const activeEditorViews = new WeakSet<EditorView>();
const mathScanCache = new WeakMap<EditorState["doc"], DocumentMathScan>();
const editorHighlightStyle = HighlightStyle.define([
    { tag: tags.comment, color: "var(--text-secondary)" },
    { tag: tags.meta, color: "var(--text-secondary)" },
    { tag: tags.heading, color: "var(--text)", fontWeight: "600" },
    { tag: tags.strong, color: "var(--text)", fontWeight: "600" },
    { tag: tags.emphasis, color: "var(--text)", fontStyle: "italic" },
    {
        tag: [
            tags.keyword,
            tags.atom,
            tags.number,
            tags.bool,
            tags.string,
            tags.operator,
            tags.definition(tags.variableName),
            tags.function(tags.variableName),
            tags.typeName,
            tags.link
        ],
        color: "var(--text)"
    }
]);

export function EditorPane(props: EditorPaneProps) {
    const [mode, setMode] = createSignal<EditorMode>("source");
    const [fileName, setFileName] = createSignal("untitled.md");
    const [fileStatus, setFileStatus] = createSignal("Draft recovery stays on this device.");
    const [folderName, setFolderName] = createSignal("");
    const [folderFiles, setFolderFiles] = createSignal<LocalFileEntry[]>([]);
    const [folderOpen, setFolderOpen] = createSignal(false);
    let editorHost: HTMLDivElement | undefined;
    let openFileInput: HTMLInputElement | undefined;
    let openFolderInput: HTMLInputElement | undefined;
    let view: EditorView | undefined;
    const inlineCompartment = new Compartment();
    let activeFileHandle: LocalFileHandle | undefined;
    let activeDirectoryHandle: LocalDirectoryHandle | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;

    onMount(() => {
        void initializeEditor();
    });

    onCleanup(() => {
        destroyed = true;
        if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
        if (view !== undefined) activeEditorViews.delete(view);
        view?.destroy();
        props.editorRef(undefined);
    });

    async function initializeEditor(): Promise<void> {
        const mayTakeInitialFocus = document.activeElement === document.body;
        let initial = props.context.editorStore.current().source;
        if (initial.length === 0) {
            const recovered = await props.context.draftRecovery.load();
            if (recovered !== null && recovered.source.length > 0) {
                initial = recovered.source;
                props.onInput(initial);
                setFileStatus("Recovered a local draft from this device.");
            }
        }
        if (destroyed || editorHost === undefined) return;
        view = new EditorView({
            state: EditorState.create({ doc: initial, extensions: editorExtensions(mode()) }),
            parent: editorHost
        });
        view.contentDOM.id = "editor";
        view.contentDOM.setAttribute("aria-label", "Markdown editor");
        view.contentDOM.setAttribute("spellcheck", "false");
        activeEditorViews.add(view);
        props.editorRef(view);
        if (mayTakeInitialFocus && document.activeElement === document.body) view.focus();
        if (mode() === "inline" && containsMath(initial)) void loadKatex(view);
    }

    function editorExtensions(selectedMode: EditorMode): Extension[] {
        return [
            markdown(),
            syntaxHighlighting(editorHighlightStyle),
            history(),
            keymap.of([
                {
                    key: "Mod-s",
                    run: () => {
                        void saveCurrent();
                        return true;
                    }
                },
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap
            ]),
            EditorView.lineWrapping,
            inlineCompartment.of(
                selectedMode === "inline" ? [inlineMathField, inlineMathPlugin, inlinePlugin] : []
            ),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                const source = update.state.doc.toString();
                props.onInput(source);
                scheduleRecovery(source);
                if (mode() === "inline" && visibleRangesContainMath(update.view)) {
                    void loadKatex(update.view);
                }
            }),
            EditorView.theme(
                {
                    "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)" },
                    ".cm-scroller": {
                        fontFamily: "var(--font-editor)",
                        fontSize: "var(--text-editor)",
                        lineHeight: "1.6"
                    },
                    ".cm-content": { minHeight: "100%", padding: "0", caretColor: "var(--text)" },
                    ".cm-line": { padding: "0" },
                    "&.cm-focused": { outline: "none" },
                    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                        backgroundColor: "color-mix(in srgb, var(--focus) 24%, transparent)"
                    }
                },
                { dark: document.documentElement.dataset.theme === "dark" }
            )
        ];
    }

    function scheduleRecovery(source: string): void {
        if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
        recoveryTimer = setTimeout(() => {
            void props.context.draftRecovery.save(source).then(
                () => setFileStatus("Draft recovered automatically on this device."),
                () =>
                    setFileStatus(
                        "Local recovery storage is unavailable; save a file to keep a copy."
                    )
            );
        }, 600);
    }

    function replaceDocument(source: string, name: string, handle?: LocalFileHandle): void {
        activeFileHandle = handle;
        setFileName(name);
        props.onInput(source);
        scheduleRecovery(source);
        if (view !== undefined) {
            view.setState(
                EditorState.create({ doc: source, extensions: editorExtensions(mode()) })
            );
            view.focus();
            if (mode() === "inline" && containsMath(source)) void loadKatex(view);
        }
    }

    async function openFile(): Promise<void> {
        try {
            const handle = await props.context.localDocuments.pickOpenFile();
            if (handle === undefined) {
                openFileInput?.click();
                return;
            }
            const file = await handle.getFile();
            const source = await file.text();
            activeDirectoryHandle = undefined;
            replaceDocument(source, file.name, handle);
            setFileStatus(`Opened ${file.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error))
                setFileStatus(`Could not open the file: ${errorMessage(error)}`);
        }
    }

    async function openFolder(): Promise<void> {
        try {
            const directory = await props.context.localDocuments.pickDirectory();
            if (directory === undefined) {
                openFolderInput?.click();
                return;
            }
            const files = await props.context.localDocuments.listMarkdownFiles(directory);
            activeFileHandle = undefined;
            activeDirectoryHandle = directory;
            setFolderName(directory.name);
            setFolderFiles(files);
            setFolderOpen(true);
            setFileStatus(`Opened the ${directory.name} folder on this device.`);
        } catch (error) {
            if (!isPickerCancellation(error))
                setFileStatus(`Could not open the folder: ${errorMessage(error)}`);
        }
    }

    async function saveCurrent(): Promise<void> {
        const source = view?.state.doc.toString() ?? props.context.editorStore.current().source;
        try {
            if (activeFileHandle !== undefined) {
                await props.context.localDocuments.writeFile(activeFileHandle, source);
                setFileStatus(`Saved ${fileName()}.`);
                return;
            }
            if (activeDirectoryHandle !== undefined) {
                const handle = await activeDirectoryHandle.getFileHandle(fileName(), {
                    create: true
                });
                await props.context.localDocuments.writeFile(handle, source);
                activeFileHandle = handle;
                setFileStatus(`Saved ${fileName()} in ${folderName()}.`);
                return;
            }
            downloadSource(source, fileName());
            setFileStatus(`Downloaded ${fileName()}; choose Save as to write to a local file.`);
        } catch (error) {
            setFileStatus(
                `Could not save ${fileName()}: ${errorMessage(error)} Your local recovery draft is preserved.`
            );
        }
    }

    async function saveAs(): Promise<void> {
        const source = view?.state.doc.toString() ?? props.context.editorStore.current().source;
        try {
            const handle = await props.context.localDocuments.pickSaveFile(fileName());
            if (handle === undefined) {
                downloadSource(source, fileName());
                setFileStatus(`Downloaded ${fileName()}.`);
                return;
            }
            await props.context.localDocuments.writeFile(handle, source);
            activeFileHandle = handle;
            setFileName(handle.name);
            setFileStatus(`Saved ${handle.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error)) {
                setFileStatus(
                    `Could not save the file: ${errorMessage(error)} Your local recovery draft is preserved.`
                );
            }
        }
    }

    async function openFileFromList(entry: LocalFileEntry): Promise<void> {
        try {
            const file = entry.handle !== undefined ? await entry.handle.getFile() : entry.file;
            if (file === undefined) return;
            replaceDocument(await file.text(), file.name, entry.handle);
            setFileStatus(`Opened ${entry.path}.`);
        } catch (error) {
            setFileStatus(`Could not open ${entry.path}: ${errorMessage(error)}`);
        }
    }

    function onFallbackFileChange(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (file === undefined) return;
        void file.text().then((source) => {
            activeDirectoryHandle = undefined;
            replaceDocument(source, file.name);
            setFileStatus(`Opened ${file.name}.`);
        });
    }

    function onFallbackFolderChange(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = "";
        const entries = files
            .filter((file) => /\.(?:md|markdown|mdown|mkd|txt)$/i.test(file.name))
            .map((file) => ({ path: file.webkitRelativePath || file.name, file }));
        setFolderFiles(entries.sort((left, right) => left.path.localeCompare(right.path)));
        setFolderName(entries[0]?.path.split(/[\\/]/)[0] ?? "Selected folder");
        activeFileHandle = undefined;
        activeDirectoryHandle = undefined;
        setFolderOpen(true);
        setFileStatus(`Loaded ${entries.length} Markdown files from the selected folder.`);
    }

    function downloadSource(source: string, name: string): void {
        props.context.fileSaver.saveBlob(
            new Blob([source], { type: "text/markdown;charset=utf-8" }),
            name || "untitled.md"
        );
    }

    function selectMode(next: EditorMode): void {
        if (next === mode()) return;
        setMode(next);
        if (view === undefined) return;
        view.dispatch({
            effects: inlineCompartment.reconfigure(
                next === "inline" ? [inlineMathField, inlineMathPlugin, inlinePlugin] : []
            )
        });
        if (next === "inline" && containsMath(view.state.doc.toString())) void loadKatex(view);
    }

    return (
        <section class="pane pane--editor" aria-label="Editor pane">
            <div class="editor-toolbar" role="toolbar" aria-label="Editor mode">
                <div class="editor-toolbar__files">
                    <button
                        type="button"
                        class="editor-file-action"
                        onClick={() => void openFile()}
                    >
                        Open file
                    </button>
                    <button
                        type="button"
                        class="editor-file-action"
                        onClick={() => void openFolder()}
                    >
                        Open folder
                    </button>
                    <button
                        type="button"
                        class="editor-file-action"
                        onClick={() => void saveCurrent()}
                    >
                        Save
                    </button>
                    <button type="button" class="editor-file-action" onClick={() => void saveAs()}>
                        Save as
                    </button>
                    <span class="editor-toolbar__filename" title={fileName()}>
                        {fileName()}
                    </span>
                </div>
                <div class="editor-toolbar__right">
                    <span class="editor-toolbar__label">Edit</span>
                    <div class="editor-toolbar__modes">
                        <button
                            type="button"
                            class="editor-mode"
                            aria-pressed={mode() === "source"}
                            onClick={() => selectMode("source")}
                        >
                            Source
                        </button>
                        <button
                            type="button"
                            class="editor-mode"
                            aria-pressed={mode() === "inline"}
                            onClick={() => selectMode("inline")}
                        >
                            Inline
                        </button>
                    </div>
                </div>
            </div>
            <div class="editor-workspace">
                <Show when={folderOpen()}>
                    <aside class="file-sidebar" aria-label={`${folderName()} files`}>
                        <div class="file-sidebar__header">
                            <span class="file-sidebar__title">{folderName()}</span>
                            <button
                                type="button"
                                class="file-sidebar__close"
                                aria-label="Close folder sidebar"
                                onClick={() => setFolderOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div class="file-sidebar__list">
                            <For each={folderFiles()}>
                                {(entry) => (
                                    <button
                                        type="button"
                                        class="file-sidebar__file"
                                        classList={{
                                            "is-current":
                                                fileName() === fileNameFromPath(entry.path)
                                        }}
                                        title={entry.path}
                                        onClick={() => void openFileFromList(entry)}
                                    >
                                        {entry.path}
                                    </button>
                                )}
                            </For>
                            <Show when={folderFiles().length === 0}>
                                <p class="file-sidebar__empty">No Markdown files in this folder.</p>
                            </Show>
                        </div>
                    </aside>
                </Show>
                <div
                    class="editor-host"
                    ref={(element) => {
                        editorHost = element;
                    }}
                />
            </div>
            <div class="editor-footer" role="status" aria-live="polite">
                {fileStatus()}
            </div>
            <input
                class="editor-file-input"
                type="file"
                accept=".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain"
                aria-label="Choose Markdown file"
                ref={(element) => {
                    openFileInput = element;
                }}
                onChange={onFallbackFileChange}
            />
            <input
                class="editor-file-input"
                type="file"
                multiple
                aria-label="Choose Markdown folder"
                ref={(element) => {
                    openFolderInput = element;
                    element.setAttribute("webkitdirectory", "");
                    element.setAttribute("directory", "");
                }}
                onChange={onFallbackFolderChange}
            />
        </section>
    );
}

function isPickerCancellation(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown local file error.";
}

function fileNameFromPath(path: string): string {
    const pieces = path.split(/[\\/]/);
    return pieces[pieces.length - 1] || "document.md";
}

const inlinePlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = inlineDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (
                update.transactions.some((transaction) =>
                    transaction.effects.some((effect) => effect.is(setMathDecorations))
                )
            ) {
                return;
            }
            if (
                update.docChanged ||
                update.viewportChanged ||
                update.transactions.some((transaction) =>
                    transaction.effects.some((effect) => effect.is(refreshInlineDecorations))
                )
            ) {
                this.decorations = inlineDecorations(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations }
);

const inlineMathField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (decorations, transaction) => {
        decorations = decorations.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (effect.is(setMathDecorations)) decorations = effect.value;
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field)
});

const inlineMathPlugin = ViewPlugin.fromClass(
    class {
        private scheduled = false;

        constructor(view: EditorView) {
            this.schedule(view);
        }

        update(update: ViewUpdate): void {
            if (
                update.docChanged ||
                update.viewportChanged ||
                update.transactions.some((transaction) =>
                    transaction.effects.some((effect) => effect.is(refreshMathDecorations))
                )
            ) {
                this.schedule(update.view);
            }
        }

        private schedule(view: EditorView): void {
            if (this.scheduled) return;
            this.scheduled = true;
            queueMicrotask(() => {
                this.scheduled = false;
                if (!activeEditorViews.has(view)) return;
                const next = mathDecorations(view);
                if (
                    RangeSet.eq(
                        [view.state.field(inlineMathField)],
                        [next],
                        0,
                        view.state.doc.length
                    )
                ) {
                    return;
                }
                view.dispatch({ effects: setMathDecorations.of(next) });
            });
        }
    },
    {}
);

interface SourceMathRegion {
    readonly from: number;
    readonly to: number;
    readonly formula: string;
    readonly display: boolean;
    readonly block: boolean;
}

function mathDecorations(view: EditorView): DecorationSet {
    const visible = visibleMathRegions(view);
    const regions = visible.regions;
    const needsEquationContext = visible.windows.some(({ source }) =>
        /\\(?:label|ref|eqref)\s*\{/.test(source)
    );
    const documentCodeRanges = visible.documentCodeRanges;
    const documentMath = visible.documentRegions;
    const equationLabels = new Map<string, string>();
    const formulaByRange = new Map<string, string>();
    let equationNumber = 0;
    for (const region of documentMath) {
        const label = /\\label\{([^}]+)\}/.exec(region.formula)?.[1];
        if (label === undefined) continue;
        const explicitTag = /\\tag\*?\{([^}]+)\}/.exec(region.formula)?.[1];
        equationNumber += 1;
        equationLabels.set(label, explicitTag ?? String(equationNumber));
        let formula = region.formula.replace(/\\label\{[^}]+\}/g, "");
        if (region.display && explicitTag === undefined) formula += `\\tag{${equationNumber}}`;
        formulaByRange.set(`${region.from}:${region.to}`, formula);
    }

    const ranges = regions.map((region) =>
        Decoration.replace({
            widget: new FormulaWidget(
                formulaByRange.get(`${region.from}:${region.to}`) ?? region.formula,
                region.display,
                katexVersion
            ),
            block: region.block
        }).range(region.from, region.to)
    );
    if (needsEquationContext) {
        for (const window of visible.windows) {
            for (const match of window.source.matchAll(/(?<!\\)\\(eqref|ref)\{([^}]+)\}/g)) {
                const from = window.from + (match.index ?? 0);
                const to = from + match[0].length;
                if (
                    !window.visibleRanges.some(([start, end]) => from < end && to > start) ||
                    documentCodeRanges.some(([start, end]) => from < end && to > start) ||
                    documentMath.some((region) => from < region.to && to > region.from)
                ) {
                    continue;
                }
                const label = match[2];
                const value = label === undefined ? undefined : equationLabels.get(label);
                if (value === undefined) continue;
                const text = match[1] === "eqref" ? `(${value})` : value;
                ranges.push(
                    Decoration.replace({ widget: new ReferenceWidget(text) }).range(from, to)
                );
            }
        }
    }
    return Decoration.set(ranges, true);
}

interface VisibleSourceWindow {
    readonly from: number;
    readonly to: number;
    readonly source: string;
    readonly visibleRanges: readonly (readonly [number, number])[];
}

interface DocumentMathScan {
    readonly regions: SourceMathRegion[];
    readonly codeRanges: [number, number][];
}

const mathContextCharacters = 2048;

function visibleMathRegions(view: EditorView): {
    readonly windows: readonly VisibleSourceWindow[];
    readonly regions: SourceMathRegion[];
    readonly documentRegions: SourceMathRegion[];
    readonly documentCodeRanges: readonly [number, number][];
} {
    const doc = view.state.doc;
    // The full scan preserves fence and delimiter context; the cache is reused
    // while scrolling through an unchanged CodeMirror document.
    const scan = scanDocumentMath(view);
    const windows: VisibleSourceWindow[] = [];
    for (const visible of view.visibleRanges) {
        const contextFrom = Math.max(0, visible.from - mathContextCharacters);
        const contextTo = Math.min(doc.length, visible.to + mathContextCharacters);
        const from = doc.lineAt(contextFrom).from;
        const to = doc.lineAt(contextTo).to;
        const previous = windows[windows.length - 1];
        if (previous !== undefined && from <= previous.to) {
            const mergedTo = Math.max(previous.to, to);
            windows[windows.length - 1] = {
                from: previous.from,
                to: mergedTo,
                source: doc.sliceString(previous.from, mergedTo),
                visibleRanges: [...previous.visibleRanges, [visible.from, visible.to]]
            };
        } else {
            windows.push({
                from,
                to,
                source: doc.sliceString(from, to),
                visibleRanges: [[visible.from, visible.to]]
            });
        }
    }

    // Keep nearby math decorated while block heights settle so viewport edges
    // do not repeatedly add and remove the same display formula.
    const regions = scan.regions.filter((region) =>
        windows.some((window) => region.from < window.to && region.to > window.from)
    );
    return {
        windows,
        regions,
        documentRegions: scan.regions,
        documentCodeRanges: scan.codeRanges
    };
}

function scanDocumentMath(view: EditorView): DocumentMathScan {
    const doc = view.state.doc;
    const cached = mathScanCache.get(doc);
    if (cached !== undefined) return cached;

    const source = doc.toString();
    const hasMathCandidate =
        source.includes("$") ||
        source.includes("\\(") ||
        source.includes("\\[") ||
        hasPandocTex(source) ||
        /^\s{0,3}(`{3,}|~{3,})\s*math\b/im.test(source);
    const codeRanges: [number, number][] = [];
    const scan = {
        regions: hasMathCandidate ? findMathRegions(source, codeRanges) : [],
        codeRanges: hasMathCandidate ? codeRanges : findCodeFenceRanges(source)
    };
    mathScanCache.set(doc, scan);
    return scan;
}

function findMathRegions(source: string, codeRanges: [number, number][] = []): SourceMathRegion[] {
    const lines = source.matchAll(/[^\n]*(?:\n|$)/g);
    const regions: SourceMathRegion[] = [];
    let fence:
        | {
              readonly from: number;
              readonly bodyFrom: number;
              readonly marker: string;
              readonly size: number;
              readonly math: boolean;
          }
        | undefined;

    for (const match of lines) {
        const line = match[0];
        if (line.length === 0) continue;
        const from = match.index ?? 0;
        const to = from + line.replace(/\n$/, "").length;
        const open = /^\s{0,3}(`{3,}|~{3,})([^\n]*)/.exec(line);
        if (fence === undefined && open !== null) {
            const marker = open[1] ?? "```";
            fence = {
                from,
                bodyFrom: from + line.length,
                marker: marker[0] ?? "`",
                size: marker.length,
                math: /^\s*math(?:\s|$)/i.test(open[2] ?? "")
            };
            continue;
        }
        if (fence !== undefined) {
            const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
            if (close !== null && close[1]?.[0] === fence.marker && close[1].length >= fence.size) {
                const end = to;
                codeRanges.push([fence.from, end]);
                if (fence.math) {
                    const formula = normalizeTexFormula(source.slice(fence.bodyFrom, from).trim());
                    if (formula.length > 0) {
                        regions.push({
                            from: fence.from,
                            to: end,
                            formula,
                            display: true,
                            block: true
                        });
                    }
                }
                fence = undefined;
            }
        }
    }
    if (fence !== undefined) codeRanges.push([fence.from, source.length]);

    const overlaps = (from: number, to: number, ranges: readonly [number, number][]): boolean =>
        ranges.some(([start, end]) => from < end && to > start);
    const inlineCodeRanges: [number, number][] = [];
    let codeLineFrom = 0;
    for (const line of source.split("\n")) {
        const lineTo = codeLineFrom + line.length;
        if (!overlaps(codeLineFrom, lineTo, codeRanges)) {
            for (const code of line.matchAll(/(`+)(.+?)\1/g)) {
                const start = codeLineFrom + (code.index ?? 0);
                const end = start + code[0].length;
                if (/^\s*\{=tex\}/.test(source.slice(end))) continue;
                inlineCodeRanges.push([start, end]);
            }
        }
        codeLineFrom = lineTo + 1;
    }
    const displayMath = /(?<!\\)\\{1,2}\[([\s\S]+?)(?<!\\)\\{1,2}\]|(?<!\\)\$\$([\s\S]+?)\$\$/g;
    for (const match of source.matchAll(displayMath)) {
        const token = match[0];
        const from = match.index ?? 0;
        const to = from + token.length;
        if (
            overlaps(from, to, codeRanges) ||
            overlaps(from, to, inlineCodeRanges) ||
            overlaps(
                from,
                to,
                regions.map(({ from, to }) => [from, to])
            )
        )
            continue;
        const block = token.includes("\n");
        regions.push({
            from,
            to,
            formula: normalizeTexFormula(match[1] ?? match[2] ?? ""),
            display: true,
            block
        });
    }

    const inlineMath =
        /(?<!\\)\\{1,2}\((.+?)(?<!\\)\\{1,2}\)|(?<!\\)\$(\S(?:[^$\n]*?\S)?)\$(?!\d)/g;
    let lineFrom = 0;
    for (const line of source.split("\n")) {
        const lineTo = lineFrom + line.length;
        if (!overlaps(lineFrom, lineTo, codeRanges)) {
            for (const match of line.matchAll(inlineMath)) {
                const token = match[0];
                const from = lineFrom + (match.index ?? 0);
                const to = from + token.length;
                if (overlaps(from, to, inlineCodeRanges) || overlaps(from, to, codeRanges))
                    continue;
                if (
                    overlaps(
                        from,
                        to,
                        regions.map(({ from, to }) => [from, to])
                    )
                )
                    continue;
                regions.push({
                    from,
                    to,
                    formula: normalizeTexFormula(match[1] ?? match[2] ?? ""),
                    display: token.startsWith("\\["),
                    block: false
                });
            }
        }
        lineFrom = lineTo + 1;
    }

    for (const { from, to, formula } of findPandocTexSequences(source)) {
        if (
            overlaps(from, to, codeRanges) ||
            overlaps(from, to, inlineCodeRanges) ||
            overlaps(
                from,
                to,
                regions.map(({ from, to }) => [from, to])
            )
        ) {
            continue;
        }
        regions.push({
            from,
            to,
            formula,
            display: false,
            block: false
        });
    }
    return regions.sort((left, right) => left.from - right.from);
}

interface MarkdownFenceContext {
    readonly marker: string;
    readonly size: number;
}

function findCodeFenceRanges(source: string): [number, number][] {
    const ranges: [number, number][] = [];
    let fence:
        | {
              readonly from: number;
              readonly marker: string;
              readonly size: number;
          }
        | undefined;

    for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
        const line = match[0];
        if (line.length === 0) continue;
        const from = match.index ?? 0;
        const to = from + line.replace(/\n$/, "").length;
        const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (fence === undefined && opening !== null) {
            const marker = opening[1] ?? "```";
            fence = { from, marker: marker[0] ?? "`", size: marker.length };
            continue;
        }
        if (fence === undefined) continue;
        const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (
            closing !== null &&
            closing[1]?.[0] === fence.marker &&
            closing[1].length >= fence.size
        ) {
            ranges.push([fence.from, to]);
            fence = undefined;
        }
    }
    if (fence !== undefined) ranges.push([fence.from, source.length]);
    return ranges;
}

function fenceBeforeVisibleLine(
    doc: EditorState["doc"],
    ranges: readonly [number, number][],
    lineFrom: number
): MarkdownFenceContext | undefined {
    const range = ranges.find(([from, to]) => from < lineFrom && lineFrom <= to);
    if (range === undefined) return undefined;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(doc.lineAt(range[0]).text)?.[1];
    return marker === undefined ? undefined : { marker: marker[0] ?? "`", size: marker.length };
}

function advanceFence(
    text: string,
    fence: MarkdownFenceContext | undefined
): MarkdownFenceContext | undefined {
    if (fence === undefined) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
        return marker === undefined ? undefined : { marker: marker[0] ?? "`", size: marker.length };
    }
    const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(text);
    return closing !== null && closing[1]?.[0] === fence.marker && closing[1].length >= fence.size
        ? undefined
        : fence;
}

class FormulaWidget extends WidgetType {
    constructor(
        private readonly formula: string,
        private readonly display: boolean,
        private readonly version: number
    ) {
        super();
    }

    override eq(other: FormulaWidget): boolean {
        return (
            this.formula === other.formula &&
            this.display === other.display &&
            this.version === other.version
        );
    }

    override toDOM(): HTMLElement {
        const wrapper = document.createElement("span");
        wrapper.className = this.display ? "cm-math-display" : "cm-math-inline";
        wrapper.setAttribute("role", "img");
        wrapper.setAttribute("aria-label", `Math formula: ${this.formula}`);
        if (katexApi === undefined) {
            wrapper.textContent = this.formula;
            return wrapper;
        }
        try {
            const output = katexApi.renderToString(this.formula, {
                displayMode: this.display,
                throwOnError: false,
                trust: false,
                macros: PHYSICS_MACROS
            });
            const parsed = new DOMParser().parseFromString(`<body>${output}</body>`, "text/html");
            for (const child of Array.from(parsed.body.childNodes)) {
                wrapper.appendChild(document.importNode(child, true));
            }
        } catch {
            wrapper.classList.add("cm-math-error");
            wrapper.textContent = this.formula;
        }
        return wrapper;
    }
}

class ReferenceWidget extends WidgetType {
    constructor(private readonly text: string) {
        super();
    }

    override eq(other: ReferenceWidget): boolean {
        return this.text === other.text;
    }

    override toDOM(): HTMLElement {
        const wrapper = document.createElement("span");
        wrapper.className = "cm-math-reference";
        wrapper.textContent = this.text;
        return wrapper;
    }
}

function inlineDecorations(view: EditorView): DecorationSet {
    const ranges: Range<Decoration>[] = [];
    const { regions: mathRegions, documentCodeRanges } = visibleMathRegions(view);
    const doc = view.state.doc;
    for (const visible of view.visibleRanges) {
        let line = doc.lineAt(visible.from);
        let fence = fenceBeforeVisibleLine(doc, documentCodeRanges, line.from);
        while (line.from <= visible.to) {
            const text = line.text;
            if (
                mathRegions.some(
                    (region) => region.block && line.from <= region.to && line.to >= region.from
                )
            ) {
                fence = advanceFence(text, fence);
                if (line.number === doc.lines) break;
                line = doc.line(line.number + 1);
                continue;
            }
            const fenceMarker = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
            if (fence === undefined && fenceMarker !== null) {
                const marker = fenceMarker[1] ?? "```";
                ranges.push(Decoration.replace({}).range(line.from, line.from + marker.length));
                fence = advanceFence(text, fence);
                if (line.number === doc.lines) break;
                line = doc.line(line.number + 1);
                continue;
            }
            if (fence !== undefined) {
                const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(text);
                if (
                    closing !== null &&
                    closing[1]?.[0] === fence.marker &&
                    closing[1].length >= fence.size
                ) {
                    ranges.push(Decoration.replace({}).range(line.from, line.to));
                } else if (text.length > 0) {
                    ranges.push(
                        Decoration.mark({ class: "cm-md-code-block" }).range(line.from, line.to)
                    );
                }
                fence = advanceFence(text, fence);
                if (line.number === doc.lines) break;
                line = doc.line(line.number + 1);
                continue;
            }

            const heading = /^\s{0,3}(#{1,6})\s+/.exec(text);
            if (heading !== null) {
                const markerLength = heading[0].length;
                ranges.push(Decoration.replace({}).range(line.from, line.from + markerLength));
                if (markerLength < text.length) {
                    ranges.push(
                        Decoration.mark({
                            class: `cm-md-heading cm-md-heading-${heading[1]?.length ?? 1}`
                        }).range(line.from + markerLength, line.to)
                    );
                }
            }

            const quote = /^\s{0,3}>\s?/.exec(text);
            if (quote !== null)
                ranges.push(Decoration.replace({}).range(line.from, line.from + quote[0].length));
            const list = /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/.exec(text);
            if (list !== null)
                ranges.push(Decoration.replace({}).range(line.from, line.from + list[0].length));
            decorateInline(line.from, text, ranges, mathRegions);
            if (line.number === doc.lines) break;
            line = doc.line(line.number + 1);
        }
    }
    return Decoration.set(ranges, true);
}

function decorateInline(
    lineFrom: number,
    text: string,
    ranges: Range<Decoration>[],
    mathRegions: readonly SourceMathRegion[]
): void {
    const protectedRanges: [number, number][] = [];
    const protect = (from: number, to: number): void => {
        protectedRanges.push([from, to]);
    };
    const intersects = (from: number, to: number): boolean =>
        protectedRanges.some(([start, end]) => from < end && to > start);

    for (const region of mathRegions) {
        if (region.block || region.from < lineFrom || region.to > lineFrom + text.length) continue;
        protect(region.from - lineFrom, region.to - lineFrom);
    }

    const code = /(`+)(.+?)\1/g;
    for (const match of text.matchAll(code)) {
        const token = match[0];
        const ticks = match[1] ?? "`";
        const start = match.index ?? 0;
        const contentFrom = start + ticks.length;
        const contentTo = start + token.length - ticks.length;
        ranges.push(Decoration.replace({}).range(lineFrom + start, lineFrom + contentFrom));
        ranges.push(
            Decoration.replace({}).range(lineFrom + contentTo, lineFrom + start + token.length)
        );
        ranges.push(
            Decoration.mark({ class: "cm-md-inline-code" }).range(
                lineFrom + contentFrom,
                lineFrom + contentTo
            )
        );
        protect(start, start + token.length);
    }

    const link = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
    for (const match of text.matchAll(link)) {
        const token = match[0];
        const label = match[1] ?? "";
        const start = match.index ?? 0;
        const labelFrom = start + 1;
        const labelTo = labelFrom + label.length;
        const to = start + token.length;
        if (intersects(start, to)) continue;
        ranges.push(Decoration.replace({}).range(lineFrom + start, lineFrom + labelFrom));
        ranges.push(
            Decoration.mark({ class: "cm-md-link" }).range(lineFrom + labelFrom, lineFrom + labelTo)
        );
        ranges.push(Decoration.replace({}).range(lineFrom + labelTo, lineFrom + to));
        protect(start, to);
    }

    decorateDelimiter(
        text,
        lineFrom,
        ranges,
        protectedRanges,
        /(\*\*|__)(.+?)\1/g,
        1,
        2,
        "cm-md-bold"
    );
    decorateDelimiter(
        text,
        lineFrom,
        ranges,
        protectedRanges,
        /(~~)(.+?)(~~)/g,
        1,
        2,
        "cm-md-strike"
    );
    decorateDelimiter(
        text,
        lineFrom,
        ranges,
        protectedRanges,
        /(==)(.+?)(==)/g,
        1,
        2,
        "cm-md-highlight"
    );
    decorateDelimiter(
        text,
        lineFrom,
        ranges,
        protectedRanges,
        /(?<!\*)(\*)([^*\n]+)(\*)(?!\*)/g,
        1,
        2,
        "cm-md-italic"
    );
    decorateDelimiter(
        text,
        lineFrom,
        ranges,
        protectedRanges,
        /(?<!_)(_)([^_\n]+)(_)(?!_)/g,
        1,
        2,
        "cm-md-italic"
    );
}

function decorateDelimiter(
    text: string,
    lineFrom: number,
    ranges: Range<Decoration>[],
    protectedRanges: readonly [number, number][],
    pattern: RegExp,
    openingGroup: number,
    contentGroup: number,
    className: string
): void {
    for (const match of text.matchAll(pattern)) {
        const token = match[0];
        const start = match.index ?? 0;
        const end = start + token.length;
        if (protectedRanges.some(([from, to]) => start < to && end > from)) continue;
        const leftDelimiter = match[openingGroup] ?? "";
        const content = match[contentGroup] ?? "";
        const contentFrom = start + leftDelimiter.length;
        const contentTo = contentFrom + content.length;
        ranges.push(Decoration.replace({}).range(lineFrom + start, lineFrom + contentFrom));
        ranges.push(Decoration.replace({}).range(lineFrom + contentTo, lineFrom + end));
        ranges.push(
            Decoration.mark({ class: className }).range(
                lineFrom + contentFrom,
                lineFrom + contentTo
            )
        );
    }
}

function containsMath(source: string): boolean {
    if (/^\s{0,3}(`{3,}|~{3,})\s*math\b[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/im.test(source)) {
        return true;
    }
    const withoutFences = source.replace(
        /^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm,
        ""
    );
    const hasRawTex = hasPandocTex(withoutFences);
    const prose = withoutFences
        .replace(/(`+)[\s\S]*?\1/g, "")
        .replace(
            /(?<!\\)\$(\d+(?:[,.]\d+)*)(\s+(?:and|or|to|for|costs?|was|is|per)\s+[^$\n]*?)\$(?=\d)/gi,
            ""
        );
    return hasRawTex || /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$?[\s\S]*?\S\$\$?/.test(prose);
}

function visibleRangesContainMath(view: EditorView): boolean {
    return view.visibleRanges.some((range) =>
        containsMath(view.state.doc.sliceString(range.from, range.to))
    );
}

function loadKatex(view: EditorView): Promise<void> {
    katexLoad ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
        ([module]) => {
            katexApi = module.default;
            katexVersion += 1;
        }
    );
    const needsChemistry = /\\(?:ce|pu)\s*\{/.test(view.state.doc.toString());
    if (needsChemistry) katexChemistryLoad ??= import("katex/contrib/mhchem");
    const chemistryLoad = needsChemistry ? katexChemistryLoad : Promise.resolve();
    return Promise.all([katexLoad, chemistryLoad]).then(() => {
        if (activeEditorViews.has(view)) {
            view.dispatch({
                effects: [refreshInlineDecorations.of(), refreshMathDecorations.of()]
            });
        }
    });
}
