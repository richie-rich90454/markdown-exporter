import type {
    Compartment as CodeMirrorCompartment,
    EditorState as CodeMirrorEditorState,
    StateEffect as CodeMirrorStateEffect,
    StateField as CodeMirrorStateField,
    Extension,
    Range
} from "@codemirror/state";
import type { HighlightStyle as CodeMirrorHighlightStyle } from "@codemirror/language";
import type {
    Decoration as CodeMirrorDecoration,
    DecorationSet,
    EditorView as CodeMirrorEditorView,
    ViewUpdate,
    WidgetType as CodeMirrorWidgetType
} from "@codemirror/view";
import type katex from "katex";
import {
    For,
    Show,
    createEffect,
    createMemo,
    createSignal,
    lazy,
    onCleanup,
    onMount
} from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import type { BookProject } from "../../domain/BookProject";
import { cloneBookProject, sameBookProject } from "../../domain/BookProjectSnapshot";
import type { EditorHistoryChangeKind, EditorHistoryPatch } from "../../domain/EditorHistory";
import { applyReplacementPatches, findReplacementPatches } from "../../domain/ReplacementPatches";
import { PHYSICS_MACROS } from "../../domain/KatexMacros";
import { findPandocTexSequences, hasPandocTex, normalizeTexFormula } from "../../domain/PandocTex";
import type * as CodeMirrorRuntimeModule from "./CodeMirrorRuntime";
import type {
    LocalDirectoryHandle,
    LocalFileEntry,
    LocalFileHandle
} from "../../port/LocalDocuments";

type EditorMode = "source" | "inline" | "rich";
type KatexApi = typeof katex;

const RichMarkdownEditor = lazy(() =>
    import("./RichMarkdownEditor").then(({ RichMarkdownEditor: component }) => ({
        default: component
    }))
);

export interface EditorPaneProps {
    context: ApplicationContext;
    onInput: (value: string, patch?: EditorHistoryPatch, kind?: EditorHistoryChangeKind) => void;
    onHistoryStep: () => void;
    editorRef: (focus: (() => void) | undefined) => void;
}

interface BookReplacementHistoryEntry {
    readonly actionId: string;
    readonly activeEntryId: string;
    readonly changes: Readonly<Record<string, readonly EditorHistoryPatch[]>>;
    readonly applied: boolean;
}

let katexApi: KatexApi | undefined;
let katexLoad: Promise<void> | undefined;
let katexChemistryLoad: Promise<unknown> | undefined;
let katexVersion = 0;
type CodeMirrorRuntime = typeof CodeMirrorRuntimeModule;
let codeMirrorRuntime: CodeMirrorRuntime | undefined;
let codeMirrorRuntimeLoad: Promise<CodeMirrorRuntime> | undefined;
const activeEditorViews = new WeakSet<CodeMirrorEditorView>();
const mathScanCache = new WeakMap<CodeMirrorEditorState["doc"], DocumentMathScan>();
interface InlineCodeMirrorExtensions {
    readonly refreshInlineDecorations: ReturnType<typeof CodeMirrorStateEffect.define<void>>;
    readonly refreshMathDecorations: ReturnType<typeof CodeMirrorStateEffect.define<void>>;
    readonly setMathDecorations: ReturnType<typeof CodeMirrorStateEffect.define<DecorationSet>>;
    readonly inlineMathField: CodeMirrorStateField<DecorationSet>;
    readonly inlineMathPlugin: Extension;
    readonly inlinePlugin: Extension;
    readonly highlightStyle: CodeMirrorHighlightStyle;
}
let inlineExtensions: InlineCodeMirrorExtensions | undefined;

function loadCodeMirrorRuntime(): Promise<CodeMirrorRuntime> {
    codeMirrorRuntimeLoad ??= import("./CodeMirrorRuntime").then((runtime) => {
        codeMirrorRuntime = runtime;
        inlineExtensions = createInlineCodeMirrorExtensions(runtime);
        return runtime;
    });
    return codeMirrorRuntimeLoad;
}

function createInlineCodeMirrorExtensions(runtime: CodeMirrorRuntime): InlineCodeMirrorExtensions {
    const refreshInlineDecorations = runtime.StateEffect.define<void>();
    const refreshMathDecorations = runtime.StateEffect.define<void>();
    const setMathDecorations = runtime.StateEffect.define<DecorationSet>();
    const inlineMathField = runtime.StateField.define<DecorationSet>({
        create: () => runtime.Decoration.none,
        update: (decorations, transaction) => {
            decorations = decorations.map(transaction.changes);
            for (const effect of transaction.effects) {
                if (effect.is(setMathDecorations)) decorations = effect.value;
            }
            return decorations;
        },
        provide: (field) => runtime.EditorView.decorations.from(field)
    });
    const inlinePlugin = runtime.ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: CodeMirrorEditorView) {
                this.decorations = inlineDecorations(view);
            }

            update(update: ViewUpdate): void {
                if (
                    update.transactions.some((transaction) =>
                        transaction.effects.some((effect) => effect.is(setMathDecorations))
                    )
                )
                    return;
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.transactions.some((transaction) =>
                        transaction.effects.some((effect) => effect.is(refreshInlineDecorations))
                    )
                )
                    this.decorations = inlineDecorations(update.view);
            }
        },
        { decorations: (plugin) => plugin.decorations }
    );
    const inlineMathPlugin = runtime.ViewPlugin.fromClass(
        class {
            private scheduled = false;

            constructor(view: CodeMirrorEditorView) {
                this.schedule(view);
            }

            update(update: ViewUpdate): void {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.transactions.some((transaction) =>
                        transaction.effects.some((effect) => effect.is(refreshMathDecorations))
                    )
                )
                    this.schedule(update.view);
            }

            private schedule(view: CodeMirrorEditorView): void {
                if (this.scheduled) return;
                this.scheduled = true;
                queueMicrotask(() => {
                    this.scheduled = false;
                    if (!activeEditorViews.has(view)) return;
                    const next = mathDecorations(view);
                    if (
                        runtime.RangeSet.eq(
                            [view.state.field(inlineMathField)],
                            [next],
                            0,
                            view.state.doc.length
                        )
                    )
                        return;
                    view.dispatch({ effects: setMathDecorations.of(next) });
                });
            }
        },
        {}
    );
    const tags = runtime.tags;
    const highlightStyle = runtime.HighlightStyle.define([
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
    return {
        refreshInlineDecorations,
        refreshMathDecorations,
        setMathDecorations,
        inlineMathField,
        inlineMathPlugin,
        inlinePlugin,
        highlightStyle
    };
}

export function EditorPane(props: EditorPaneProps) {
    const [mode, setMode] = createSignal<EditorMode>("rich");
    const [fileName, setFileName] = createSignal("untitled.md");
    const [fileStatus, setFileStatus] = createSignal("Draft recovery stays on this device.");
    const [folderName, setFolderName] = createSignal("");
    const [folderFiles, setFolderFiles] = createSignal<LocalFileEntry[]>([]);
    const [folderOpen, setFolderOpen] = createSignal(false);
    const [bookProjectOpen, setBookProjectOpen] = createSignal(false);
    const [sourceEditorLoaded, setSourceEditorLoaded] = createSignal(false);
    let editorHost: HTMLDivElement | undefined;
    let openFileInput: HTMLInputElement | undefined;
    let openFolderInput: HTMLInputElement | undefined;
    let view: CodeMirrorEditorView | undefined;
    let inlineCompartment: CodeMirrorCompartment | undefined;
    let activeFileHandle: LocalFileHandle | undefined;
    let activeDirectoryHandle: LocalDirectoryHandle | undefined;
    let activeBookHandle: LocalFileHandle | undefined;
    let activeBookDirectoryHandle: LocalDirectoryHandle | undefined;
    let activeBookName: string | undefined;
    let activeFileBaseline: string | undefined;
    let activeBookBaseline: BookProject | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;
    let syncingFromStore = false;
    let bookReplacementSequence = 0;
    let editorModeWasExplicitlySelected = false;
    let modeSwitchSequence = 0;
    let richFocus: (() => void) | undefined;
    let richSource: (() => string) | undefined;
    let richNavigate: ((heading: string) => void) | undefined;
    let e2eSourceHook: (() => string) | undefined;
    const [bookQuery, setBookQuery] = createSignal("");
    const manuscriptSearchResults = createMemo(() =>
        props.context.bookProjectStore.search(bookQuery())
    );
    const [replaceText, setReplaceText] = createSignal("");
    const [replaceWith, setReplaceWith] = createSignal("");
    const [distractionFree, setDistractionFree] = createSignal(false);
    const [bookReplacements, setBookReplacements] = createSignal<
        ReadonlyMap<string, BookReplacementHistoryEntry>
    >(new Map());
    const bookReplacementHistoryStep = createMemo(() => {
        const editorStore = props.context.editorStore;
        editorStore.current();
        const undoStep = editorStore.nextUndoStep();
        if (undoStep?.type === "external") {
            const replacement = bookReplacements().get(undoStep.actionId);
            if (replacement?.applied === true) return { replacement, redo: false };
        }
        const redoStep = editorStore.nextRedoStep();
        if (redoStep?.type === "external") {
            const replacement = bookReplacements().get(redoStep.actionId);
            if (replacement?.applied === false) return { replacement, redo: true };
        }
        return undefined;
    });
    const bookStore = props.context.bookProjectStore;
    const [wordCounts, setWordCounts] = createSignal({
        section: bookStore.getChapterWordCount(bookStore.activeEntryId()),
        manuscript: bookStore.getManuscriptWordCount()
    });
    let wordCountTimer: ReturnType<typeof setTimeout> | undefined;
    let focusModeButton: HTMLButtonElement | undefined;

    onMount(() => {
        void initializeEditor();
        window.addEventListener("keydown", onFocusModeKeydown, true);
    });

    createEffect(() => {
        bookStore.current();
        const entryId = bookStore.activeEntryId();
        if (wordCountTimer !== undefined) clearTimeout(wordCountTimer);
        wordCountTimer = setTimeout(() => {
            setWordCounts({
                section: bookStore.getChapterWordCount(entryId),
                manuscript: bookStore.getManuscriptWordCount()
            });
        }, 350);
    });

    createEffect(() => {
        const source = props.context.editorStore.current().source;
        if (view === undefined || view.state.doc.toString() === source) return;
        syncingFromStore = true;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: source },
            annotations: codeMirrorRuntime!.Transaction.addToHistory.of(false)
        });
        syncingFromStore = false;
    });

    onCleanup(() => {
        destroyed = true;
        if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
        if (wordCountTimer !== undefined) clearTimeout(wordCountTimer);
        window.removeEventListener("keydown", onFocusModeKeydown, true);
        const sourceHooks = window as unknown as { __markdownEditorSource?: () => string };
        if (e2eSourceHook !== undefined && sourceHooks.__markdownEditorSource === e2eSourceHook) {
            delete sourceHooks.__markdownEditorSource;
        }
        if (view !== undefined) activeEditorViews.delete(view);
        view?.destroy();
        props.editorRef(undefined);
    });

    async function initializeEditor(): Promise<void> {
        const mayTakeInitialFocus = document.activeElement === document.body;
        let initial = props.context.editorStore.current().source;
        if (initial.length === 0) {
            const recovered = await props.context.draftRecovery.load();
            if (
                recovered !== null &&
                (recovered.source.length > 0 || recovered.bookProject !== undefined)
            ) {
                if (recovered.bookProject !== undefined) {
                    props.context.bookProjectStore.open(
                        recovered.bookProject,
                        recovered.activeEntryId
                    );
                    setBookProjectOpen(true);
                    const active = props.context.bookProjectStore.select(
                        props.context.bookProjectStore.activeEntryId()
                    );
                    initial = active.source;
                    setFileName(active.entry.path);
                    setFolderName(recovered.bookProject.manifest.metadata.title);
                    setFolderOpen(true);
                } else {
                    initial = recovered.source;
                    props.context.bookProjectStore.resetToMarkdown(initial, "Recovered draft");
                }
                props.context.editorStore.reset(initial);
                props.onInput(initial);
                setFileStatus(
                    recovered.bookProject === undefined
                        ? "Recovered a local draft from this device."
                        : "Recovered the book project from this device."
                );
            }
        }
        if (destroyed || editorHost === undefined) return;
        e2eSourceHook = () => currentSource();
        if (import.meta.env.MODE === "e2e") {
            (
                window as unknown as { __markdownEditorSource?: () => string }
            ).__markdownEditorSource = e2eSourceHook;
        }
        props.editorRef(() => {
            if (mode() === "rich") richFocus?.();
            else view?.focus();
        });
        if (mode() !== "rich") await initializeSourceEditor(initial, mode(), mayTakeInitialFocus);
    }

    async function initializeSourceEditor(
        source = currentSource(),
        selectedMode: EditorMode = mode(),
        mayTakeInitialFocus = false,
        focusOrigin?: Element | null
    ): Promise<void> {
        if (destroyed || editorHost === undefined) return;
        const runtime = await loadCodeMirrorRuntime();
        if (destroyed || editorHost === undefined || selectedMode !== mode()) return;
        inlineCompartment ??= new runtime.Compartment();
        const currentStoreSource = props.context.editorStore.current().source;
        const latestSource = selectedMode === mode() ? currentStoreSource : source;
        view = new runtime.EditorView({
            state: runtime.EditorState.create({
                doc: latestSource,
                extensions: editorExtensions(selectedMode)
            }),
            parent: editorHost
        });
        setSourceEditorLoaded(true);
        if (import.meta.env.MODE === "e2e") {
            e2eSourceHook = () => view?.state.doc.toString() ?? "";
            (
                window as unknown as { __markdownEditorSource?: () => string }
            ).__markdownEditorSource = e2eSourceHook;
        }
        view.contentDOM.id = selectedMode === "rich" ? "source-editor" : "editor";
        view.contentDOM.setAttribute(
            "aria-label",
            selectedMode === "rich" ? "Markdown source" : "Markdown editor"
        );
        view.contentDOM.setAttribute("spellcheck", "false");
        activeEditorViews.add(view);
        if (
            selectedMode !== "rich" &&
            ((editorModeWasExplicitlySelected &&
                (focusOrigin === undefined || document.activeElement === focusOrigin)) ||
                (mayTakeInitialFocus && document.activeElement === document.body))
        ) {
            view.focus();
        }
        if (selectedMode === "inline" && containsMath(latestSource)) void loadKatex(view);
    }

    function editorExtensions(selectedMode: EditorMode): Extension[] {
        const runtime = codeMirrorRuntime;
        const extensions = inlineExtensions;
        if (runtime === undefined || extensions === undefined || inlineCompartment === undefined) {
            throw new Error("The source editor has not finished loading.");
        }
        return [
            runtime.markdown(),
            runtime.syntaxHighlighting(extensions.highlightStyle),
            runtime.keymap.of([
                {
                    key: "Mod-s",
                    run: () => {
                        void saveCurrent();
                        return true;
                    }
                },
                {
                    key: "Mod-z",
                    run: () => performHistoryStep(false)
                },
                {
                    key: "Shift-Mod-z",
                    run: () => performHistoryStep(true)
                },
                {
                    key: "Mod-y",
                    run: () => performHistoryStep(true)
                },
                ...runtime.defaultKeymap,
                ...runtime.searchKeymap
            ]),
            runtime.EditorView.lineWrapping,
            inlineCompartment.of(
                selectedMode === "inline"
                    ? [
                          extensions.inlineMathField,
                          extensions.inlineMathPlugin,
                          extensions.inlinePlugin
                      ]
                    : []
            ),
            runtime.EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                if (syncingFromStore) return;
                const source = update.state.doc.toString();
                forgetUndoneBookReplacements();
                const changes: EditorHistoryPatch[] = [];
                update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                    changes.push({
                        from: fromA,
                        removed: update.startState.doc.sliceString(fromA, toA),
                        inserted: inserted.toString()
                    });
                });
                if (changes.length === 1) {
                    const patch = changes[0];
                    if (patch !== undefined) {
                        const paste = update.transactions.some((transaction) =>
                            (transaction.annotation(runtime.Transaction.userEvent) ?? "").includes(
                                "paste"
                            )
                        );
                        const kind: EditorHistoryChangeKind = paste
                            ? "paste"
                            : patch.removed.length === 0
                              ? "typing"
                              : patch.inserted.length === 0
                                ? "deletion"
                                : "replacement";
                        props.onInput(source, patch, kind);
                    } else {
                        props.onInput(source);
                    }
                } else {
                    // Multi-range changes are uncommon (for example, a
                    // multi-selection edit). A source diff keeps them in the
                    // shared history as one safe replacement step.
                    props.onInput(source);
                }
                pruneExpiredBookReplacements();
                scheduleRecovery(source);
                if (mode() === "inline" && visibleRangesContainMath(update.view)) {
                    void loadKatex(update.view);
                }
            }),
            runtime.EditorView.theme(
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
            void saveRecoveryNow(source).then(
                () => setFileStatus("Draft recovered automatically on this device."),
                () =>
                    setFileStatus(
                        "Local recovery storage is unavailable; save a file to keep a copy."
                    )
            );
        }, 600);
    }

    async function saveRecoveryNow(source: string): Promise<void> {
        const project = props.context.bookProjectStore.current();
        const includeProject = bookProjectOpen();
        await props.context.draftRecovery.save(
            source,
            includeProject ? project : undefined,
            includeProject ? props.context.bookProjectStore.activeEntryId() : undefined
        );
    }

    async function preserveRecoveryAfterSaveFailure(
        source: string,
        operation: string,
        error: unknown
    ): Promise<void> {
        if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
        recoveryTimer = undefined;
        try {
            await saveRecoveryNow(source);
            setFileStatus(
                `${operation}: ${errorMessage(error)} A local recovery draft was saved on this device.`
            );
        } catch (recoveryError) {
            setFileStatus(
                `${operation}: ${errorMessage(error)} Recovery could not be saved: ${errorMessage(recoveryError)}`
            );
        }
    }

    async function assertFileUnchanged(
        handle: LocalFileHandle,
        baseline: string | undefined
    ): Promise<void> {
        if (baseline === undefined) return;
        const current = await (await handle.getFile()).text();
        if (current !== baseline) {
            throw new Error(
                "This file changed outside the editor. Reopen it before saving, or use Save as to keep both versions."
            );
        }
    }

    async function assertBookUnchanged(): Promise<void> {
        const baseline = activeBookBaseline;
        if (baseline === undefined) return;
        let current: BookProject | null;
        if (activeBookDirectoryHandle !== undefined) {
            current = await props.context.bookProjectFiles.readFolder(activeBookDirectoryHandle);
        } else if (activeBookHandle !== undefined) {
            const file = await activeBookHandle.getFile();
            current = await props.context.bookProjectFiles.readArchive(
                new Uint8Array(await file.arrayBuffer())
            );
        } else {
            return;
        }
        if (current === null || !sameBookProject(current, baseline)) {
            throw new Error(
                "This book changed outside the editor. Reopen it before saving, or use Save book as to keep both versions."
            );
        }
    }

    function replaceDocument(source: string, name: string, handle?: LocalFileHandle): void {
        setBookProjectOpen(false);
        setBookReplacements(new Map());
        activeFileHandle = handle;
        activeFileBaseline = handle === undefined ? undefined : source;
        activeBookHandle = undefined;
        activeBookDirectoryHandle = undefined;
        activeBookName = undefined;
        activeBookBaseline = undefined;
        activeDirectoryHandle = undefined;
        setFileName(name);
        props.context.bookProjectStore.resetToMarkdown(source, removeExtension(name));
        props.context.editorStore.reset(source);
        props.onInput(source);
        scheduleRecovery(source);
        if (view !== undefined) {
            view.setState(
                codeMirrorRuntime!.EditorState.create({
                    doc: source,
                    extensions: editorExtensions(mode())
                })
            );
            view.focus();
            if (mode() === "inline" && containsMath(source)) void loadKatex(view);
        }
    }

    async function openFile(): Promise<void> {
        try {
            const handle = await props.context.localDocuments.pickOpenFile();
            if (handle === undefined) {
                if (openFileInput !== undefined) {
                    openFileInput.accept =
                        ".md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain";
                }
                openFileInput?.click();
                return;
            }
            const file = await handle.getFile();
            if (/\.mdbook$/i.test(file.name)) {
                const project = await props.context.bookProjectFiles.readArchive(
                    new Uint8Array(await file.arrayBuffer())
                );
                openBookProject(project, file.name, handle);
                setFileStatus(`Opened ${file.name}.`);
                return;
            }
            const source = await file.text();
            activeDirectoryHandle = undefined;
            replaceDocument(source, file.name, handle);
            setFileStatus(`Opened ${file.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error))
                setFileStatus(`Could not open the file: ${errorMessage(error)}`);
        }
    }

    async function openBook(): Promise<void> {
        try {
            const handle = await props.context.localDocuments.pickOpenBookFile();
            if (handle === undefined) {
                if (openFileInput !== undefined) openFileInput.accept = ".mdbook,application/zip";
                openFileInput?.click();
                return;
            }
            const file = await handle.getFile();
            if (!/\.mdbook$/i.test(file.name)) throw new Error("Choose a .mdbook project archive.");
            const project = await props.context.bookProjectFiles.readArchive(
                new Uint8Array(await file.arrayBuffer())
            );
            openBookProject(project, file.name, handle);
            setFileStatus(`Opened ${file.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error))
                setFileStatus(`Could not open the book: ${errorMessage(error)}`);
        }
    }

    async function openFolder(): Promise<void> {
        try {
            const directory = await props.context.localDocuments.pickDirectory();
            if (directory === undefined) {
                openFolderInput?.click();
                return;
            }
            const project = await props.context.bookProjectFiles.readFolder(directory);
            if (project !== null) {
                openBookProject(project, undefined, undefined, directory);
                setFileStatus(`Opened the ${directory.name} book folder.`);
                return;
            }
            setBookProjectOpen(false);
            setBookReplacements(new Map());
            const files = await props.context.localDocuments.listMarkdownFiles(directory);
            activeFileHandle = undefined;
            activeFileBaseline = undefined;
            activeDirectoryHandle = directory;
            activeBookHandle = undefined;
            activeBookDirectoryHandle = undefined;
            activeBookName = undefined;
            activeBookBaseline = undefined;
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
        const source = currentSource();
        props.onInput(source);
        try {
            if (activeBookDirectoryHandle !== undefined) {
                props.context.bookProjectStore.updateActive(source);
                const project = props.context.bookProjectStore.current();
                await assertBookUnchanged();
                await props.context.bookProjectFiles.writeFolder(
                    activeBookDirectoryHandle,
                    project
                );
                activeBookBaseline = cloneBookProject(project);
                setFileStatus(`Saved the ${folderName()} book folder.`);
                return;
            }
            if (activeBookHandle !== undefined) {
                props.context.bookProjectStore.updateActive(source);
                const project = props.context.bookProjectStore.current();
                await assertBookUnchanged();
                const archive = await props.context.bookProjectFiles.writeArchive(project);
                await props.context.localDocuments.writeFile(activeBookHandle, archive);
                activeBookBaseline = cloneBookProject(project);
                setFileStatus(`Saved ${activeBookName ?? "the book project"}.`);
                return;
            }
            if (activeBookName !== undefined && /\.mdbook$/i.test(activeBookName)) {
                props.context.bookProjectStore.updateActive(source);
                const archive = await props.context.bookProjectFiles.writeArchive(
                    props.context.bookProjectStore.current()
                );
                props.context.fileSaver.saveBlob(
                    new Blob([archive as BlobPart], { type: "application/zip" }),
                    activeBookName
                );
                setFileStatus(`Downloaded ${activeBookName}.`);
                return;
            }
            if (activeFileHandle !== undefined) {
                await assertFileUnchanged(activeFileHandle, activeFileBaseline);
                await props.context.localDocuments.writeFile(activeFileHandle, source);
                activeFileBaseline = source;
                setFileStatus(`Saved ${fileName()}.`);
                return;
            }
            if (activeDirectoryHandle !== undefined) {
                const existing = await activeDirectoryHandle
                    .getFileHandle(fileName())
                    .catch((error: unknown) => {
                        if (isNotFoundError(error)) return undefined;
                        throw error;
                    });
                if (existing !== undefined) {
                    throw new Error(
                        "A file with this name already exists in the selected folder. Use Save as to choose another file."
                    );
                }
                const handle = await activeDirectoryHandle.getFileHandle(fileName(), {
                    create: true
                });
                await props.context.localDocuments.writeFile(handle, source);
                activeFileHandle = handle;
                activeFileBaseline = source;
                setFileStatus(`Saved ${fileName()} in ${folderName()}.`);
                return;
            }
            downloadSource(source, fileName());
            setFileStatus(`Downloaded ${fileName()}; choose Save as to write to a local file.`);
        } catch (error) {
            await preserveRecoveryAfterSaveFailure(source, `Could not save ${fileName()}`, error);
        }
    }

    async function saveAs(): Promise<void> {
        const source = currentSource();
        props.onInput(source);
        try {
            const handle = await props.context.localDocuments.pickSaveFile(fileName());
            if (handle === undefined) {
                const downloadName = fileNameFromPath(fileName());
                downloadSource(source, downloadName);
                activeFileHandle = undefined;
                activeFileBaseline = undefined;
                activeDirectoryHandle = undefined;
                activeBookHandle = undefined;
                activeBookDirectoryHandle = undefined;
                activeBookName = undefined;
                activeBookBaseline = undefined;
                detachBookAsMarkdown(source, downloadName);
                setFileName(downloadName);
                setFileStatus(`Downloaded ${downloadName}.`);
                return;
            }
            await props.context.localDocuments.writeFile(handle, source);
            activeFileHandle = handle;
            activeFileBaseline = source;
            activeBookHandle = undefined;
            activeBookDirectoryHandle = undefined;
            activeBookName = undefined;
            activeBookBaseline = undefined;
            activeDirectoryHandle = undefined;
            detachBookAsMarkdown(source, handle.name);
            setBookProjectOpen(false);
            setFileName(handle.name);
            setFileStatus(`Saved ${handle.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error)) {
                await preserveRecoveryAfterSaveFailure(source, "Could not save the file", error);
            }
        }
    }

    function detachBookAsMarkdown(source: string, name: string): void {
        if (!props.context.bookProjectStore.isBookProject()) return;
        props.context.bookProjectStore.resetToMarkdown(source, removeExtension(name));
        props.context.editorStore.reset(source);
        setBookReplacements(new Map());
        props.onHistoryStep();
        setBookProjectOpen(false);
        setFolderOpen(false);
        setFolderFiles([]);
        scheduleRecovery(source);
    }

    async function saveBookAs(): Promise<void> {
        const source = currentSource();
        props.onInput(source);
        try {
            props.context.bookProjectStore.updateActive(source);
            const project = props.context.bookProjectStore.current();
            if (activeBookDirectoryHandle !== undefined) {
                await assertBookUnchanged();
                await props.context.bookProjectFiles.writeFolder(
                    activeBookDirectoryHandle,
                    project
                );
                activeBookBaseline = cloneBookProject(project);
                props.context.bookProjectStore.markAsBookProject();
                setBookProjectOpen(true);
                scheduleRecovery(source);
                setFileStatus(`Saved the ${folderName()} book folder.`);
                return;
            }
            const suggestedName = `${slug(project.manifest.metadata.title)}.mdbook`;
            const handle = await props.context.localDocuments.pickSaveFile(suggestedName);
            const archive = await props.context.bookProjectFiles.writeArchive(project);
            if (handle === undefined) {
                props.context.fileSaver.saveBlob(
                    new Blob([archive as BlobPart], { type: "application/zip" }),
                    suggestedName
                );
                activeFileHandle = undefined;
                activeFileBaseline = undefined;
                activeBookHandle = undefined;
                activeBookDirectoryHandle = undefined;
                activeBookName = suggestedName;
                activeBookBaseline = cloneBookProject(project);
                props.context.bookProjectStore.markAsBookProject();
                setBookProjectOpen(true);
                setFolderOpen(true);
                setFileName(suggestedName);
                scheduleRecovery(source);
                setFileStatus(`Downloaded ${suggestedName}.`);
                return;
            }
            await props.context.localDocuments.writeFile(handle, archive);
            activeFileHandle = undefined;
            activeFileBaseline = undefined;
            activeDirectoryHandle = undefined;
            activeBookHandle = handle;
            activeBookName = handle.name;
            activeBookBaseline = cloneBookProject(project);
            props.context.bookProjectStore.markAsBookProject();
            setBookProjectOpen(true);
            setFolderOpen(true);
            setFileName(handle.name);
            scheduleRecovery(source);
            setFileStatus(`Saved ${handle.name}.`);
        } catch (error) {
            if (!isPickerCancellation(error)) {
                await preserveRecoveryAfterSaveFailure(source, "Could not save the book", error);
            }
        }
    }

    async function openFileFromList(entry: LocalFileEntry): Promise<void> {
        const bookEntry =
            activeBookName !== undefined ||
            activeBookHandle !== undefined ||
            activeBookDirectoryHandle !== undefined
                ? props.context.bookProjectStore
                      .current()
                      .manifest.entries.find((candidate) => candidate.path === entry.path)
                : undefined;
        if (bookEntry !== undefined) {
            try {
                const selected = props.context.bookProjectStore.select(bookEntry.id);
                setBookReplacements(new Map());
                setFileName(bookEntry.path);
                props.context.editorStore.reset(selected.source);
                props.onInput(selected.source);
                scheduleRecovery(selected.source);
                setFileStatus(`Opened ${bookEntry.title}.`);
                return;
            } catch (error) {
                setFileStatus(`Could not open ${bookEntry.title}: ${errorMessage(error)}`);
                return;
            }
        }
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
        if (/\.mdbook$/i.test(file.name)) {
            void file.arrayBuffer().then(async (buffer) => {
                try {
                    const project = await props.context.bookProjectFiles.readArchive(
                        new Uint8Array(buffer)
                    );
                    openBookProject(project, file.name);
                    setFileStatus(`Opened ${file.name}.`);
                } catch (error) {
                    setFileStatus(`Could not open the book: ${errorMessage(error)}`);
                }
            });
            return;
        }
        void file.text().then((source) => {
            activeDirectoryHandle = undefined;
            replaceDocument(source, file.name);
            setFileStatus(`Opened ${file.name}.`);
        });
    }

    async function onFallbackFolderChange(event: Event): Promise<void> {
        const input = event.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = "";
        try {
            const project = await props.context.bookProjectFiles.readFiles(files);
            if (project !== null) {
                const archiveName = `${slug(project.manifest.metadata.title)}.mdbook`;
                openBookProject(project, archiveName);
                setFileStatus(
                    `Opened the ${project.manifest.metadata.title} book from the selected folder. Save book as creates a .mdbook copy.`
                );
                return;
            }
        } catch (error) {
            setFileStatus(`Could not open the selected book folder: ${errorMessage(error)}`);
            return;
        }
        const entries = files
            .filter((file) => /\.(?:md|markdown|mdown|mkd|txt)$/i.test(file.name))
            .map((file) => ({ path: file.webkitRelativePath || file.name, file }));
        setBookProjectOpen(false);
        setBookReplacements(new Map());
        setFolderFiles(entries.sort((left, right) => left.path.localeCompare(right.path)));
        setFolderName(entries[0]?.path.split(/[\\/]/)[0] ?? "Selected folder");
        activeFileHandle = undefined;
        activeFileBaseline = undefined;
        activeDirectoryHandle = undefined;
        activeBookHandle = undefined;
        activeBookDirectoryHandle = undefined;
        activeBookName = undefined;
        activeBookBaseline = undefined;
        setFolderOpen(true);
        setFileStatus(`Loaded ${entries.length} Markdown files from the selected folder.`);
    }

    function downloadSource(source: string, name: string): void {
        props.context.fileSaver.saveBlob(
            new Blob([source], { type: "text/markdown;charset=utf-8" }),
            name || "untitled.md"
        );
    }

    function openBookProject(
        project: BookProject,
        name?: string,
        fileHandle?: LocalFileHandle,
        directoryHandle?: LocalDirectoryHandle
    ): void {
        const entry =
            project.manifest.entries.find((candidate) => candidate.role === "chapter") ??
            project.manifest.entries[0];
        if (entry === undefined) throw new Error("This book has no chapter or section to open.");
        const source = project.files[entry.path];
        if (typeof source !== "string")
            throw new Error(`The Markdown file for “${entry.title}” is missing.`);
        props.context.bookProjectStore.open(project, entry.id);
        setBookProjectOpen(true);
        setBookReplacements(new Map());
        props.context.editorStore.reset(source);
        props.onInput(source);
        activeFileHandle = undefined;
        activeFileBaseline = undefined;
        activeDirectoryHandle = undefined;
        activeBookHandle = fileHandle;
        activeBookDirectoryHandle = directoryHandle;
        activeBookName = name;
        activeBookBaseline = cloneBookProject(project);
        scheduleRecovery(source);
        setFileName(entry.path);
        setFolderName(project.manifest.metadata.title);
        setFolderFiles(
            project.manifest.entries.map((bookEntry) => ({
                path: bookEntry.path,
                file: new File(
                    [String(project.files[bookEntry.path] ?? "")],
                    fileNameFromPath(bookEntry.path),
                    {
                        type: "text/markdown"
                    }
                )
            }))
        );
        setFolderOpen(true);
    }

    async function selectMode(next: EditorMode): Promise<void> {
        if (next === mode()) return;
        const sequence = ++modeSwitchSequence;
        const previousMode = mode();
        const focusOrigin = document.activeElement;
        const source = currentSource();
        if (previousMode === "rich") {
            props.onInput(source);
            scheduleRecovery(source);
        }
        props.context.editorStore.breakGroup();
        editorModeWasExplicitlySelected = true;
        setMode(next);
        if (next !== "rich" && view === undefined) {
            try {
                await initializeSourceEditor(source, next, false, focusOrigin);
            } catch (error) {
                if (sequence !== modeSwitchSequence) return;
                setMode(previousMode);
                setFileStatus(`The source editor could not be loaded: ${errorMessage(error)}`);
                return;
            }
        }
        if (sequence !== modeSwitchSequence) return;
        view?.contentDOM.setAttribute("id", next === "rich" ? "source-editor" : "editor");
        view?.contentDOM.setAttribute(
            "aria-label",
            next === "rich" ? "Markdown source" : "Markdown editor"
        );
        if (view === undefined) return;
        view.dispatch({
            effects: inlineCompartment!.reconfigure(
                next === "inline"
                    ? [
                          inlineExtensions!.inlineMathField,
                          inlineExtensions!.inlineMathPlugin,
                          inlineExtensions!.inlinePlugin
                      ]
                    : []
            )
        });
        if (next === "inline" && containsMath(view.state.doc.toString())) void loadKatex(view);
        requestAnimationFrame(() => {
            // Switching modes transfers focus into the editor, but must not
            // steal it back if the user has already moved to another control.
            if (document.activeElement !== focusOrigin) return;
            if (next === "rich") richFocus?.();
            else view?.focus();
        });
    }

    function currentSource(): string {
        return mode() === "rich"
            ? (richSource?.() ?? props.context.editorStore.current().source)
            : (view?.state.doc.toString() ?? props.context.editorStore.current().source);
    }

    function performHistoryStep(redo: boolean): boolean {
        const editorStore = props.context.editorStore;
        const step = redo ? editorStore.redoStep() : editorStore.undoStep();
        if (step === undefined) return false;
        if (step.type === "external") {
            applyBookReplacement(step.actionId, redo, step.source);
        } else {
            props.onHistoryStep();
        }
        pruneExpiredBookReplacements();
        return true;
    }

    function applyBookReplacement(actionId: string, applied: boolean, activeSource: string): void {
        const replacement = bookReplacements().get(actionId);
        if (replacement === undefined || replacement.applied === applied) {
            props.context.bookProjectStore.updateActive(activeSource);
            props.onHistoryStep();
            setFileStatus("The manuscript replacement history could not be restored completely.");
            return;
        }
        const currentProject = props.context.bookProjectStore.current();
        const files = { ...currentProject.files };
        for (const [path, patches] of Object.entries(replacement.changes)) {
            const source = files[path];
            if (typeof source !== "string") {
                props.context.bookProjectStore.updateActive(activeSource);
                props.onHistoryStep();
                setFileStatus(
                    "A section is unavailable, so the manuscript replacement could not be restored safely."
                );
                return;
            }
            const restored = applyReplacementPatches(source, patches, applied);
            if (restored === undefined) {
                props.context.bookProjectStore.updateActive(activeSource);
                props.onHistoryStep();
                setFileStatus(
                    "A section changed outside the undo history, so the manuscript replacement could not be restored safely."
                );
                return;
            }
            files[path] = restored;
        }
        const project = { ...currentProject, files };
        const activeEntry = project.manifest.entries.find(
            (entry) => entry.id === replacement.activeEntryId
        );
        if (activeEntry === undefined || files[activeEntry.path] !== activeSource) {
            props.context.bookProjectStore.updateActive(activeSource);
            props.onHistoryStep();
            setFileStatus(
                "The active section no longer matches the manuscript replacement history."
            );
            return;
        }
        props.context.bookProjectStore.open(project, replacement.activeEntryId);
        props.context.bookProjectStore.select(replacement.activeEntryId);
        setBookReplacements((current) => {
            const next = new Map(current);
            next.set(actionId, { ...replacement, applied });
            return next;
        });
        props.onHistoryStep();
        scheduleRecovery(activeSource);
        setFileStatus(
            applied ? "Reapplied the manuscript replacement." : "Undid the manuscript replacement."
        );
    }

    function forgetUndoneBookReplacements(): void {
        const editorStore = props.context.editorStore;
        setBookReplacements((current) => {
            const next = new Map(
                [...current].filter(
                    ([actionId, entry]) => entry.applied && editorStore.hasExternalAction(actionId)
                )
            );
            return next.size === current.size ? current : next;
        });
    }

    function pruneExpiredBookReplacements(): void {
        const editorStore = props.context.editorStore;
        setBookReplacements((current) => {
            const next = new Map(
                [...current].filter(([actionId]) => editorStore.hasExternalAction(actionId))
            );
            return next.size === current.size ? current : next;
        });
    }

    function activateBookEntry(entryId: string, line?: number): void {
        try {
            setBookReplacements(new Map());
            const selected = props.context.bookProjectStore.select(entryId);
            setFileName(selected.entry.path);
            props.context.editorStore.reset(selected.source);
            props.onInput(selected.source);
            scheduleRecovery(selected.source);
            setFileStatus(`Opened ${selected.entry.title}.`);
            if (window.innerWidth <= 600) setFolderOpen(false);
            if (line !== undefined) {
                requestAnimationFrame(() => {
                    const source = props.context.editorStore.current().source;
                    const offset =
                        source
                            .split(/\r?\n/)
                            .slice(0, Math.max(0, line - 1))
                            .join("\n").length + (line > 1 ? 1 : 0);
                    if (mode() === "rich")
                        richNavigate?.(
                            line === undefined
                                ? selected.entry.title
                                : (
                                      selected.source.split(/\r?\n/)[line - 1] ??
                                      selected.entry.title
                                  ).trim()
                        );
                    else {
                        view?.dispatch({
                            selection: { anchor: Math.min(offset, view.state.doc.length) },
                            scrollIntoView: true
                        });
                        view?.focus();
                    }
                });
            }
        } catch (error) {
            setFileStatus(`Could not open the section: ${errorMessage(error)}`);
        }
    }

    function addBookEntry(role: "chapter" | "front-matter" | "back-matter"): void {
        const fallback =
            role === "chapter" ? "New chapter" : role === "front-matter" ? "Preface" : "References";
        const title = window.prompt("Section title", fallback);
        if (title === null) return;
        try {
            const entry = props.context.bookProjectStore.addEntry(role, title);
            activateBookEntry(entry.id);
            setFolderOpen(true);
        } catch (error) {
            setFileStatus(`Could not add the section: ${errorMessage(error)}`);
        }
    }

    function renameBookEntry(entryId: string, title: string): void {
        const next = window.prompt("Section title", title);
        if (next === null) return;
        try {
            props.context.bookProjectStore.renameEntry(entryId, next);
            scheduleRecovery(currentSource());
        } catch (error) {
            setFileStatus(`Could not rename the section: ${errorMessage(error)}`);
        }
    }

    function moveBookEntry(entryId: string, direction: -1 | 1): void {
        const entries = props.context.bookProjectStore.current().manifest.entries;
        const index = entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) return;
        props.context.bookProjectStore.reorderEntry(entryId, index + direction);
        scheduleRecovery(currentSource());
    }

    function removeBookEntry(entryId: string, title: string): void {
        if (!window.confirm(`Delete “${title}” from this book? This cannot be undone.`)) return;
        try {
            setBookReplacements(new Map());
            const wasActive = props.context.bookProjectStore.activeEntryId() === entryId;
            props.context.bookProjectStore.removeEntry(entryId);
            if (wasActive) activateBookEntry(props.context.bookProjectStore.activeEntryId());
            else scheduleRecovery(currentSource());
            setFileStatus(`Removed ${title}.`);
        } catch (error) {
            setFileStatus(`Could not remove the section: ${errorMessage(error)}`);
        }
    }

    function updateBookMetadata(metadata: Partial<BookProject["manifest"]["metadata"]>): void {
        props.context.bookProjectStore.updateMetadata(metadata);
        scheduleRecovery(currentSource());
    }

    function updateBibliography(source: string): void {
        props.context.bookProjectStore.updateBibliography(source);
        scheduleRecovery(currentSource());
    }

    function selectCitationStyle(style: string): void {
        if (style !== "apa" && style !== "harvard1" && style !== "vancouver") return;
        props.context.bookProjectStore.setBuiltInCitationStyle(style);
        scheduleRecovery(currentSource());
    }

    function selectedCitationStyle(): string {
        const manifest = props.context.bookProjectStore.current().manifest;
        return manifest.citationStylePath === undefined
            ? (manifest.citationStyleId ?? "apa")
            : "custom";
    }

    function bibliographySource(): string {
        const project = props.context.bookProjectStore.current();
        const path = project.manifest.bibliographyPath;
        return path === undefined || typeof project.files[path] !== "string"
            ? ""
            : project.files[path];
    }

    async function importBookAsset(
        file: File | undefined,
        kind: "cover" | "bibliography" | "citation-style"
    ): Promise<void> {
        if (file === undefined) return;
        const maxSize = kind === "cover" ? 20 * 1024 * 1024 : 2 * 1024 * 1024;
        if (file.size > maxSize) {
            setFileStatus(
                `That file exceeds the ${Math.round(maxSize / (1024 * 1024))} MiB limit.`
            );
            return;
        }
        try {
            const store = props.context.bookProjectStore;
            if (kind === "cover") {
                const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "png";
                if (!/^(?:png|jpe?g|gif|svg|webp|avif)$/.test(extension))
                    throw new Error("Choose a PNG, JPEG, GIF, SVG, WebP, or AVIF image.");
                const path = `assets/cover.${extension}`;
                store.putFile(path, new Uint8Array(await file.arrayBuffer()));
                store.updateMetadata({ coverPath: path });
            } else if (kind === "bibliography") {
                if (!file.name.toLowerCase().endsWith(".bib"))
                    throw new Error("Choose a BibTeX .bib file.");
                const path = "references/library.bib";
                store.putFile(path, await file.text());
                store.setBibliographyPath(path);
            } else {
                if (!file.name.toLowerCase().endsWith(".csl"))
                    throw new Error("Choose a CSL .csl style file.");
                const path = "styles/custom.csl";
                store.putFile(path, await file.text());
                store.setCitationStylePath(path);
            }
            scheduleRecovery(currentSource());
            setFileStatus(`${file.name} added to the book project.`);
        } catch (error) {
            setFileStatus(`Could not add that file: ${errorMessage(error)}`);
        }
    }

    function replaceAcrossBook(): void {
        if (replaceText().length === 0) return;
        const store = props.context.bookProjectStore;
        const before = store.current();
        const activeEntryId = store.activeEntryId();
        const count = store.replaceAll(replaceText(), replaceWith());
        if (count === 0) {
            setFileStatus("No matching text was found.");
            return;
        }
        const after = store.current();
        const changes: Record<string, readonly EditorHistoryPatch[]> = {};
        for (const entry of before.manifest.entries) {
            const oldSource = before.files[entry.path];
            const newSource = after.files[entry.path];
            if (
                typeof oldSource === "string" &&
                typeof newSource === "string" &&
                oldSource !== newSource
            ) {
                const patches = findReplacementPatches(
                    oldSource,
                    replaceText().trim(),
                    replaceWith()
                );
                if (applyReplacementPatches(oldSource, patches, true) !== newSource) {
                    props.context.editorStore.reset(store.select(activeEntryId).source);
                    setBookReplacements(new Map());
                    props.onHistoryStep();
                    scheduleRecovery(newSource);
                    setFileStatus(
                        "The text was replaced, but its undo record could not be created safely."
                    );
                    return;
                }
                changes[entry.path] = patches;
            }
        }
        if (Object.keys(changes).length === 0) {
            setFileStatus("The matching text already had that value, so nothing changed.");
            return;
        }
        const retainedPayloadBytes = replacementPayloadSize(changes);
        const active = store.select(activeEntryId);
        const actionId = `book-replace-${Date.now().toString(36)}-${(++bookReplacementSequence).toString(36)}`;
        const recorded = props.context.editorStore.recordExternalTransition(
            actionId,
            active.source,
            retainedPayloadBytes
        );
        if (!recorded) {
            setBookReplacements(new Map());
            props.onHistoryStep();
            scheduleRecovery(active.source);
            setFileStatus(
                `Replaced ${count} occurrence${count === 1 ? "" : "s"}. This large replacement exceeds the undo history limit.`
            );
            return;
        }
        const editorStore = props.context.editorStore;
        const nextReplacements = new Map(
            [...bookReplacements()].filter(
                ([id, entry]) => entry.applied && editorStore.hasExternalAction(id)
            )
        );
        nextReplacements.set(actionId, { actionId, activeEntryId, changes, applied: true });
        setBookReplacements(nextReplacements);
        props.onHistoryStep();
        scheduleRecovery(active.source);
        setFileStatus(
            `Replaced ${count} occurrence${count === 1 ? "" : "s"} across the manuscript. Undo is available here and with Ctrl+Z.`
        );
    }

    function outlineItems(): { title: string; line: number; level: number }[] {
        const source = props.context.editorStore.current().source;
        const items: { title: string; line: number; level: number }[] = [];
        let fence: { marker: string; size: number } | undefined;
        source.split(/\r?\n/).forEach((text, index) => {
            const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
            if (marker !== undefined) {
                if (fence === undefined) fence = { marker: marker[0] ?? "`", size: marker.length };
                else if (marker[0] === fence.marker && marker.length >= fence.size)
                    fence = undefined;
                return;
            }
            if (fence !== undefined) return;
            const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
            if (heading?.[2] !== undefined) {
                const title = heading[2]
                    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
                    .replace(/[*_`~]/g, "")
                    .trim();
                items.push({ title, line: index + 1, level: heading[1]?.length ?? 1 });
            }
        });
        return items;
    }

    function onFocusModeKeydown(event: KeyboardEvent): void {
        if (event.key !== "Escape" || !distractionFree()) return;
        event.preventDefault();
        event.stopPropagation();
        setDistractionFree(false);
        requestAnimationFrame(() => focusModeButton?.focus());
    }

    function toggleDistractionFree(): void {
        const next = !distractionFree();
        setDistractionFree(next);
        if (next) {
            requestAnimationFrame(() => {
                if (mode() === "rich") richFocus?.();
                else view?.focus();
            });
        } else {
            requestAnimationFrame(() => focusModeButton?.focus());
        }
    }

    return (
        <section
            class="pane pane--editor"
            classList={{ "pane--editor-focus": distractionFree() }}
            aria-label="Editor pane"
        >
            <div class="editor-toolbar" role="toolbar" aria-label="Editor controls">
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
                        onClick={() => void openBook()}
                    >
                        Open book
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
                    <button
                        type="button"
                        class="editor-file-action"
                        onClick={() => void saveBookAs()}
                    >
                        Save book
                    </button>
                    <button
                        type="button"
                        class="editor-file-action"
                        aria-expanded={folderOpen()}
                        aria-controls={folderOpen() ? "manuscript-sidebar" : undefined}
                        onClick={() => setFolderOpen((open) => !open)}
                    >
                        Manuscript
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
                            aria-pressed={mode() === "rich"}
                            onClick={() => {
                                void selectMode("rich");
                            }}
                        >
                            Rich
                        </button>
                        <button
                            type="button"
                            class="editor-mode"
                            aria-pressed={mode() === "source"}
                            onClick={() => {
                                void selectMode("source");
                            }}
                        >
                            Source
                        </button>
                        <button
                            type="button"
                            class="editor-mode"
                            aria-pressed={mode() === "inline"}
                            onClick={() => {
                                void selectMode("inline");
                            }}
                        >
                            Inline
                        </button>
                    </div>
                    <button
                        type="button"
                        class="editor-focus-toggle"
                        aria-pressed={distractionFree()}
                        aria-keyshortcuts="Escape"
                        onClick={toggleDistractionFree}
                        ref={(element) => (focusModeButton = element)}
                    >
                        {distractionFree() ? "Exit focus mode" : "Focus mode"}
                    </button>
                </div>
            </div>
            <div class="editor-workspace">
                <Show when={folderOpen()}>
                    <aside
                        id="manuscript-sidebar"
                        class="file-sidebar"
                        aria-label={
                            bookProjectOpen()
                                ? `${folderName()} manuscript tools`
                                : `${folderName()} files`
                        }
                    >
                        <div class="file-sidebar__header">
                            <span class="file-sidebar__title">Manuscript</span>
                            <button
                                type="button"
                                class="file-sidebar__close"
                                aria-label="Close manuscript sidebar and return to the editor"
                                onClick={() => setFolderOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <Show when={bookProjectOpen()}>
                            <div class="book-tools">
                                <Show
                                    when={
                                        props.context.bookProjectStore.current().manifest.entries
                                            .length > 0
                                    }
                                >
                                    <p class="book-tools__count">
                                        <span>
                                            {wordCounts().section.toLocaleString()} words in this
                                            section
                                        </span>
                                        <span aria-hidden="true"> · </span>
                                        <span>
                                            {wordCounts().manuscript.toLocaleString()} words in the
                                            manuscript
                                        </span>
                                    </p>
                                </Show>
                                <div class="book-tools__actions">
                                    <button type="button" onClick={() => addBookEntry("chapter")}>
                                        Add chapter
                                    </button>
                                    <details class="book-tools__more">
                                        <summary>More</summary>
                                        <button
                                            type="button"
                                            onClick={() => addBookEntry("front-matter")}
                                        >
                                            Add front matter
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => addBookEntry("back-matter")}
                                        >
                                            Add back matter
                                        </button>
                                    </details>
                                </div>
                                <nav class="book-tools__sections" aria-label="Book sections">
                                    <h3>Book sections</h3>
                                    <ol>
                                        <For
                                            each={
                                                props.context.bookProjectStore.current().manifest
                                                    .entries
                                            }
                                        >
                                            {(entry, index) => (
                                                <li
                                                    classList={{
                                                        "is-current":
                                                            props.context.bookProjectStore.activeEntryId() ===
                                                            entry.id
                                                    }}
                                                >
                                                    <button
                                                        type="button"
                                                        class="book-tools__section"
                                                        aria-current={
                                                            props.context.bookProjectStore.activeEntryId() ===
                                                            entry.id
                                                                ? "page"
                                                                : undefined
                                                        }
                                                        onClick={() => activateBookEntry(entry.id)}
                                                    >
                                                        <span>{entry.title}</span>
                                                        <small>
                                                            {entry.role === "front-matter"
                                                                ? "Front matter"
                                                                : entry.role === "back-matter"
                                                                  ? "Back matter"
                                                                  : "Chapter"}
                                                        </small>
                                                    </button>
                                                    <div class="book-tools__section-actions">
                                                        <button
                                                            type="button"
                                                            aria-label={`Rename ${entry.title}`}
                                                            title="Rename"
                                                            onClick={() =>
                                                                renameBookEntry(
                                                                    entry.id,
                                                                    entry.title
                                                                )
                                                            }
                                                        >
                                                            Rename
                                                        </button>
                                                        <button
                                                            type="button"
                                                            aria-label={`Move ${entry.title} up`}
                                                            title="Move up"
                                                            disabled={index() === 0}
                                                            onClick={() =>
                                                                moveBookEntry(entry.id, -1)
                                                            }
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            type="button"
                                                            aria-label={`Move ${entry.title} down`}
                                                            title="Move down"
                                                            disabled={
                                                                index() ===
                                                                props.context.bookProjectStore.current()
                                                                    .manifest.entries.length -
                                                                    1
                                                            }
                                                            onClick={() =>
                                                                moveBookEntry(entry.id, 1)
                                                            }
                                                        >
                                                            ↓
                                                        </button>
                                                        <button
                                                            type="button"
                                                            aria-label={`Delete ${entry.title}`}
                                                            title="Delete"
                                                            onClick={() =>
                                                                removeBookEntry(
                                                                    entry.id,
                                                                    entry.title
                                                                )
                                                            }
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                </li>
                                            )}
                                        </For>
                                    </ol>
                                </nav>
                                <details class="book-tools__details">
                                    <summary>Book details</summary>
                                    <label>
                                        Title
                                        <input
                                            name="book-title"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.title
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    title: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Subtitle
                                        <input
                                            name="book-subtitle"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.subtitle ?? ""
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    subtitle: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Authors
                                        <input
                                            name="book-authors"
                                            autocomplete="off"
                                            value={props.context.bookProjectStore
                                                .current()
                                                .manifest.metadata.authors.join(", ")}
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    authors: event.currentTarget.value
                                                        .split(",")
                                                        .map((author) => author.trim())
                                                        .filter(Boolean)
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Language
                                        <input
                                            name="book-language"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.language
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    language: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Publisher
                                        <input
                                            name="book-publisher"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.publisher ?? ""
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    publisher: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        ISBN
                                        <input
                                            name="book-isbn"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.isbn ?? ""
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    isbn: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Description
                                        <textarea
                                            name="book-description"
                                            autocomplete="off"
                                            value={
                                                props.context.bookProjectStore.current().manifest
                                                    .metadata.description ?? ""
                                            }
                                            onInput={(event) =>
                                                updateBookMetadata({
                                                    description: event.currentTarget.value
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        Cover
                                        <input
                                            name="book-cover"
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/avif"
                                            onChange={(event) => {
                                                void importBookAsset(
                                                    event.currentTarget.files?.[0],
                                                    "cover"
                                                );
                                                event.currentTarget.value = "";
                                            }}
                                        />
                                    </label>
                                    <label>
                                        Bibliography (BibTeX)
                                        <textarea
                                            name="book-bibliography-editor"
                                            spellcheck="false"
                                            value={bibliographySource()}
                                            onInput={(event) =>
                                                updateBibliography(event.currentTarget.value)
                                            }
                                            placeholder="@book{key, author={Author}, title={Title}, year={2026}}"
                                        />
                                    </label>
                                    <label>
                                        Reference style
                                        <select
                                            name="book-citation-style-choice"
                                            value={selectedCitationStyle()}
                                            onChange={(event) =>
                                                selectCitationStyle(event.currentTarget.value)
                                            }
                                        >
                                            <option value="apa">APA 7</option>
                                            <option value="harvard1">Harvard</option>
                                            <option value="vancouver">Vancouver</option>
                                            <Show
                                                when={
                                                    props.context.bookProjectStore.current()
                                                        .manifest.citationStylePath !== undefined
                                                }
                                            >
                                                <option value="custom">Custom CSL</option>
                                            </Show>
                                        </select>
                                    </label>
                                    <label>
                                        Import custom CSL style
                                        <input
                                            name="book-citation-style-file"
                                            type="file"
                                            accept=".csl,application/xml,text/xml"
                                            onChange={(event) => {
                                                void importBookAsset(
                                                    event.currentTarget.files?.[0],
                                                    "citation-style"
                                                );
                                                event.currentTarget.value = "";
                                            }}
                                        />
                                    </label>
                                </details>
                                <label class="book-tools__search">
                                    Find in manuscript
                                    <input
                                        name="manuscript-search"
                                        type="search"
                                        autocomplete="off"
                                        value={bookQuery()}
                                        onInput={(event) => setBookQuery(event.currentTarget.value)}
                                        placeholder="Search all sections…"
                                    />
                                </label>
                                <Show when={bookQuery().trim().length > 0}>
                                    <ul class="book-tools__matches">
                                        <For each={manuscriptSearchResults().slice(0, 30)}>
                                            {(match) => (
                                                <li>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            activateBookEntry(
                                                                match.entryId,
                                                                match.line
                                                            )
                                                        }
                                                    >
                                                        <strong>
                                                            {match.title}, line {match.line}
                                                        </strong>
                                                        <span>{match.excerpt}</span>
                                                    </button>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                    <Show when={manuscriptSearchResults().length === 0}>
                                        <p class="book-tools__empty">
                                            No matches in this manuscript.
                                        </p>
                                    </Show>
                                </Show>
                                <details class="book-tools__details">
                                    <summary>Replace across manuscript</summary>
                                    <label>
                                        Find
                                        <input
                                            name="manuscript-replace-find"
                                            autocomplete="off"
                                            value={replaceText()}
                                            onInput={(event) =>
                                                setReplaceText(event.currentTarget.value)
                                            }
                                        />
                                    </label>
                                    <label>
                                        Replace with
                                        <input
                                            name="manuscript-replace-with"
                                            autocomplete="off"
                                            value={replaceWith()}
                                            onInput={(event) =>
                                                setReplaceWith(event.currentTarget.value)
                                            }
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={replaceText().length === 0}
                                        onClick={() => replaceAcrossBook()}
                                    >
                                        Replace all
                                    </button>
                                    <Show when={bookReplacementHistoryStep()}>
                                        {(historyStep) => (
                                            <button
                                                type="button"
                                                class="book-tools__replace-undo"
                                                onClick={() =>
                                                    performHistoryStep(historyStep().redo)
                                                }
                                            >
                                                {historyStep().redo
                                                    ? "Redo replace all"
                                                    : "Undo replace all"}
                                            </button>
                                        )}
                                    </Show>
                                </details>
                                <nav
                                    class="book-tools__outline"
                                    aria-label="Current section outline"
                                >
                                    <h3>Outline</h3>
                                    <Show
                                        when={outlineItems().length > 0}
                                        fallback={<p>No headings in this section.</p>}
                                    >
                                        <ul>
                                            <For each={outlineItems()}>
                                                {(heading) => (
                                                    <li>
                                                        <button
                                                            type="button"
                                                            classList={{
                                                                [`level-${heading.level}`]: true
                                                            }}
                                                            onClick={() => {
                                                                if (mode() === "rich")
                                                                    richNavigate?.(heading.title);
                                                                else {
                                                                    const offset =
                                                                        view?.state.doc.line(
                                                                            heading.line
                                                                        ).from ?? 0;
                                                                    view?.dispatch({
                                                                        selection: {
                                                                            anchor: offset
                                                                        },
                                                                        scrollIntoView: true
                                                                    });
                                                                    view?.focus();
                                                                }
                                                            }}
                                                        >
                                                            {heading.title}
                                                        </button>
                                                    </li>
                                                )}
                                            </For>
                                        </ul>
                                    </Show>
                                </nav>
                            </div>
                        </Show>
                        <div class="file-sidebar__list">
                            <For each={folderFiles()}>
                                {(entry) => (
                                    <button
                                        type="button"
                                        class="file-sidebar__file"
                                        classList={{
                                            "is-current": props.context.bookProjectStore
                                                .current()
                                                .manifest.entries.some(
                                                    (bookEntry) => bookEntry.path === entry.path
                                                )
                                                ? props.context.bookProjectStore
                                                      .current()
                                                      .manifest.entries.find(
                                                          (bookEntry) =>
                                                              bookEntry.path === entry.path
                                                      )?.id ===
                                                  props.context.bookProjectStore.activeEntryId()
                                                : fileName() === fileNameFromPath(entry.path)
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
                <div class="editor-surfaces">
                    <div
                        class="editor-host"
                        classList={{ "editor-host--inactive": mode() === "rich" }}
                        ref={(element) => {
                            editorHost = element;
                        }}
                    />
                    <Show when={mode() !== "rich" && !sourceEditorLoaded()}>
                        <p class="editor-source-loading" role="status">
                            Loading source editor…
                        </p>
                    </Show>
                    <RichMarkdownEditor
                        source={() => props.context.editorStore.current().source}
                        active={() => mode() === "rich"}
                        onInput={(source) => {
                            forgetUndoneBookReplacements();
                            props.onInput(source);
                            pruneExpiredBookReplacements();
                            scheduleRecovery(source);
                        }}
                        onUndo={(redo) => performHistoryStep(redo)}
                        onSave={() => void saveCurrent()}
                        onFocusReady={(focus) => (richFocus = focus)}
                        onSourceReady={(read) => (richSource = read)}
                        onNavigateReady={(navigate) => (richNavigate = navigate)}
                    />
                </div>
            </div>
            <div class="editor-footer" role="status" aria-live="polite">
                {fileStatus()}
            </div>
            <input
                class="editor-file-input"
                type="file"
                accept=".md,.markdown,.mdown,.mkd,.txt,.mdbook,text/markdown,text/plain,application/zip"
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
                onChange={(event) => {
                    void onFallbackFolderChange(event);
                }}
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

function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "NotFoundError"
    );
}

function fileNameFromPath(path: string): string {
    const pieces = path.split(/[\\/]/);
    return pieces[pieces.length - 1] || "document.md";
}

function removeExtension(name: string): string {
    return name.replace(/\.[^.]+$/, "").trim() || "Untitled manuscript";
}

function slug(title: string): string {
    const value = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return value.length > 0 ? value : "book";
}

interface SourceMathRegion {
    readonly from: number;
    readonly to: number;
    readonly formula: string;
    readonly display: boolean;
    readonly block: boolean;
}

function mathDecorations(view: CodeMirrorEditorView): DecorationSet {
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
        codeMirrorRuntime!.Decoration.replace({
            widget: createFormulaWidget(
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
                    codeMirrorRuntime!.Decoration.replace({
                        widget: createReferenceWidget(text)
                    }).range(from, to)
                );
            }
        }
    }
    return codeMirrorRuntime!.Decoration.set(ranges, true);
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

function visibleMathRegions(view: CodeMirrorEditorView): {
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

function scanDocumentMath(view: CodeMirrorEditorView): DocumentMathScan {
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
    doc: CodeMirrorEditorState["doc"],
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

let formulaWidgetConstructor:
    | (new (formula: string, display: boolean, version: number) => CodeMirrorWidgetType)
    | undefined;
let referenceWidgetConstructor: (new (text: string) => CodeMirrorWidgetType) | undefined;

function createFormulaWidget(
    formula: string,
    display: boolean,
    version: number
): CodeMirrorWidgetType {
    const runtime = codeMirrorRuntime;
    if (runtime === undefined) throw new Error("The source editor has not finished loading.");
    formulaWidgetConstructor ??= class extends runtime.WidgetType {
        constructor(
            private readonly formula: string,
            private readonly display: boolean,
            private readonly version: number
        ) {
            super();
        }

        override eq(other: CodeMirrorWidgetType): boolean {
            return (
                other instanceof this.constructor &&
                (other as typeof this).formula === this.formula &&
                (other as typeof this).display === this.display &&
                (other as typeof this).version === this.version
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
                const parsed = new DOMParser().parseFromString(
                    `<body>${output}</body>`,
                    "text/html"
                );
                for (const child of Array.from(parsed.body.childNodes)) {
                    wrapper.appendChild(document.importNode(child, true));
                }
            } catch {
                wrapper.classList.add("cm-math-error");
                wrapper.textContent = this.formula;
            }
            return wrapper;
        }
    };
    return new formulaWidgetConstructor(formula, display, version);
}

function createReferenceWidget(text: string): CodeMirrorWidgetType {
    const runtime = codeMirrorRuntime;
    if (runtime === undefined) throw new Error("The source editor has not finished loading.");
    referenceWidgetConstructor ??= class extends runtime.WidgetType {
        constructor(private readonly text: string) {
            super();
        }

        override eq(other: CodeMirrorWidgetType): boolean {
            return other instanceof this.constructor && (other as typeof this).text === this.text;
        }

        override toDOM(): HTMLElement {
            const wrapper = document.createElement("span");
            wrapper.className = "cm-math-reference";
            wrapper.textContent = this.text;
            return wrapper;
        }
    };
    return new referenceWidgetConstructor(text);
}

function inlineDecorations(view: CodeMirrorEditorView): DecorationSet {
    const Decoration = codeMirrorRuntime!.Decoration;
    const ranges: Range<CodeMirrorDecoration>[] = [];
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
    ranges: Range<CodeMirrorDecoration>[],
    mathRegions: readonly SourceMathRegion[]
): void {
    const Decoration = codeMirrorRuntime!.Decoration;
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
    ranges: Range<CodeMirrorDecoration>[],
    protectedRanges: readonly [number, number][],
    pattern: RegExp,
    openingGroup: number,
    contentGroup: number,
    className: string
): void {
    const Decoration = codeMirrorRuntime!.Decoration;
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

function visibleRangesContainMath(view: CodeMirrorEditorView): boolean {
    return view.visibleRanges.some((range) =>
        containsMath(view.state.doc.sliceString(range.from, range.to))
    );
}

function loadKatex(view: CodeMirrorEditorView): Promise<void> {
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
                effects: [
                    inlineExtensions!.refreshInlineDecorations.of(),
                    inlineExtensions!.refreshMathDecorations.of()
                ]
            });
        }
    });
}

function replacementPayloadSize(
    changes: Readonly<Record<string, readonly EditorHistoryPatch[]>>
): number {
    const encoder = new TextEncoder();
    let bytes = 0;
    for (const patches of Object.values(changes)) {
        for (const patch of patches) {
            bytes +=
                encoder.encode(patch.removed).byteLength +
                encoder.encode(patch.inserted).byteLength +
                24;
        }
    }
    return bytes;
}
