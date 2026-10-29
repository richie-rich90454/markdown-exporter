import { commandsCtx, editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { table } from "@milkdown/crepe/feature/table";
import "@milkdown/crepe/theme/common/style.css";
import {
    toggleEmphasisCommand,
    toggleLinkCommand,
    toggleStrongCommand,
    wrapInHeadingCommand
} from "@milkdown/kit/preset/commonmark";
import { insertTableCommand } from "@milkdown/kit/preset/gfm";
import { insert, replaceAll } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { preserveMarkdownSource } from "../../domain/MarkdownSourceFidelity";
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";

export interface RichMarkdownEditorProps {
    readonly source: () => string;
    readonly active: () => boolean;
    readonly onInput: (source: string) => void;
    readonly onUndo: (redo: boolean) => void;
    readonly onSave: () => void;
    readonly onFocusReady?: (focus: (() => void) | undefined) => void;
    readonly onSourceReady?: (read: (() => string) | undefined) => void;
    readonly onNavigateReady?: (navigate: ((heading: string) => void) | undefined) => void;
}

/** ProseMirror-backed writing surface; Markdown remains the external document format. */
export function RichMarkdownEditor(props: RichMarkdownEditorProps) {
    const [mathDiagnostic, setMathDiagnostic] = createSignal("");
    let root: HTMLDivElement | undefined;
    let host: HTMLDivElement | undefined;
    let editor: Editor | undefined;
    let crepe: CrepeBuilder | undefined;
    let observer: MutationObserver | undefined;
    let destroying = false;
    let lastExternalSource = "";
    let fidelitySource = "";
    let fidelityBaseline = "";
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let mathEnabled = false;
    let chemistryEnabled = false;
    let enablingMath = false;
    let rebuildGeneration = 0;
    let selectionMemory:
        | { readonly anchor: number; readonly head: number; readonly doc: ProseMirrorNode }
        | undefined;
    let selectionMemoryView: EditorView | undefined;

    onMount(() => {
        if (host === undefined) return;
        root?.addEventListener("keydown", onKeyDown, true);
        root?.addEventListener("paste", pasteMarkdown, true);
        const initial = props.source();
        lastExternalSource = initial;
        fidelitySource = initial;
        mathEnabled = containsMath(initial);
        void createEditor(initial, mathEnabled)
            .then(() => {
                completeEditorSetup();
            })
            .catch(async (error: unknown) => {
                if (mathEnabled && !destroying) {
                    try {
                        const failedCrepe = crepe;
                        crepe = undefined;
                        editor = undefined;
                        try {
                            await failedCrepe?.destroy();
                        } catch {
                            // A partially initialized instance must not block the source-preserving fallback.
                        }
                        await createEditor(initial, false);
                        completeEditorSetup();
                        setMathDiagnostic(
                            "Math editing could not be loaded. The formulas remain in the document and source mode is available."
                        );
                        return;
                    } catch {
                        // Report the original rich-editor failure below.
                    }
                }
                setMathDiagnostic(
                    error instanceof Error
                        ? `The rich editor could not be loaded: ${error.message}`
                        : "The rich editor could not be loaded. Source editing and preview remain available."
                );
            });
    });

    createEffect(() => {
        const next = props.source();
        // Source mode is the user's active surface, so keep the hidden
        // ProseMirror tree stale until the author returns to Rich. Parsing and
        // serializing a book-sized document for an invisible editor on every
        // keystroke made source editing take tens of seconds.
        if (!props.active() || editor === undefined || next === lastExternalSource) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        const previousSelection = {
            anchor: view.state.selection.anchor,
            head: view.state.selection.head,
            focused: view.hasFocus(),
            scrollTop: view.dom.scrollTop,
            scrollLeft: view.dom.scrollLeft
        };
        lastExternalSource = next;
        fidelitySource = next;
        observer?.disconnect();
        editor.action(replaceAll(next));
        selectionMemory = undefined;
        fidelityBaseline = serializeMarkdown();
        const syncedView = editor.action((ctx) => ctx.get(editorViewCtx));
        restoreSelection(syncedView, previousSelection.anchor, previousSelection.head);
        syncedView.dom.scrollTop = previousSelection.scrollTop;
        syncedView.dom.scrollLeft = previousSelection.scrollLeft;
        if (previousSelection.focused && props.active()) syncedView.focus();
        observer?.observe(syncedView.dom, { childList: true, characterData: true, subtree: true });
        // Replacing the document while the editor was hidden does not produce
        // a mutation after the observer is reattached. Inspect the new source
        // here so switching from Source to Rich upgrades the schema as needed.
        if (!mathEnabled && containsMath(next)) void enableMath();
        else if (mathEnabled && !chemistryEnabled && containsChemistry(next))
            void enableChemistry();
    });

    createEffect(() => {
        const active = props.active();
        if (host === undefined) return;
        host.inert = !active;
        host.setAttribute("aria-hidden", String(!active));
        const content = host.querySelector<HTMLElement>(".ProseMirror");
        content?.setAttribute("aria-label", active ? "Markdown editor" : "Rich text editor");
        content?.setAttribute("role", "textbox");
        content?.setAttribute("aria-multiline", "true");
        if (content !== null && content !== undefined)
            content.id = active ? "editor" : "rich-editor";
        content?.setAttribute("contenteditable", String(active));
    });

    onCleanup(() => {
        destroying = true;
        rebuildGeneration += 1;
        root?.removeEventListener("keydown", onKeyDown, true);
        root?.removeEventListener("paste", pasteMarkdown, true);
        selectionMemoryView?.dom.removeEventListener("blur", rememberEditorSelection, true);
        observer?.disconnect();
        if (syncTimer !== undefined) clearTimeout(syncTimer);
        props.onFocusReady?.(undefined);
        props.onSourceReady?.(undefined);
        props.onNavigateReady?.(undefined);
        void crepe?.destroy();
        editor = undefined;
        crepe = undefined;
    });

    function runCommand(command: unknown, payload?: unknown): void {
        restoreToolbarSelection();
        editor?.action((ctx) => ctx.get(commandsCtx).call(command as never, payload as never));
    }

    function rememberEditorSelection(): void {
        if (editor === undefined) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        const { selection, doc } = view.state;
        if (!selection.empty)
            selectionMemory = { anchor: selection.anchor, head: selection.head, doc };
    }

    function restoreToolbarSelection(): void {
        if (editor === undefined || selectionMemory === undefined) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        // A keyboard-focused toolbar needs the selection captured when the
        // editor blurred. Pointer activation keeps focus in ProseMirror, so
        // its live selection is authoritative even if an older remembered
        // range exists for this same document.
        if (!view.hasFocus() && view.state.doc.eq(selectionMemory.doc)) {
            restoreSelection(view, selectionMemory.anchor, selectionMemory.head);
        }
        selectionMemory = undefined;
    }

    function insertAtSelection(markdown: string): void {
        restoreToolbarSelection();
        editor?.action(insert(markdown));
    }

    function completeEditorSetup(): void {
        if (destroying || editor === undefined) return;
        fidelityBaseline = serializeMarkdown();
        syncEditorSurface();
        props.onSourceReady?.(() => readMarkdown());
        props.onNavigateReady?.(navigateToText);
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        trackEditorSelection(view);
        observer ??= new MutationObserver(scheduleMarkdownSync);
        observer.observe(view.dom, { childList: true, characterData: true, subtree: true });
        if (props.active() && document.activeElement === document.body) view.focus();
    }

    function trackEditorSelection(view: EditorView): void {
        if (selectionMemoryView === view) return;
        selectionMemoryView?.dom.removeEventListener("blur", rememberEditorSelection, true);
        selectionMemoryView = view;
        view.dom.addEventListener("blur", rememberEditorSelection, true);
    }

    function pasteMarkdown(event: ClipboardEvent): void {
        const target = event.target;
        if (!props.active() || !(target instanceof Node) || !host?.contains(target)) return;
        // Rich HTML pasted from Word or a browser should use Milkdown's normal
        // clipboard parser. This path is only for plain-text Markdown.
        if ((event.clipboardData?.getData("text/html") ?? "").length > 0) return;
        const source = event.clipboardData?.getData("text/plain") ?? "";
        if (source.length === 0 || !looksLikeMarkdownDocument(source)) return;
        event.preventDefault();
        event.stopPropagation();
        editor?.action(insert(source));
    }

    function scheduleMarkdownSync(): void {
        if (syncTimer !== undefined) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            flushMarkdown();
            const source = readMarkdown();
            if (!mathEnabled && containsMath(source)) void enableMath();
            else if (mathEnabled && !chemistryEnabled && containsChemistry(source))
                void enableChemistry();
        }, 120);
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (!props.active() || !(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z") {
            event.preventDefault();
            event.stopPropagation();
            flushMarkdown();
            props.onUndo(event.shiftKey);
        } else if (key === "y") {
            event.preventDefault();
            event.stopPropagation();
            flushMarkdown();
            props.onUndo(true);
        } else if (key === "s") {
            event.preventDefault();
            event.stopPropagation();
            flushMarkdown();
            props.onSave();
        }
    }

    function flushMarkdown(): void {
        if (editor === undefined) return;
        if (syncTimer !== undefined) clearTimeout(syncTimer);
        const serialized = serializeMarkdown();
        const markdown = preserveMarkdownSource(fidelitySource, fidelityBaseline, serialized);
        if (markdown !== lastExternalSource) {
            lastExternalSource = markdown;
            fidelitySource = markdown;
            fidelityBaseline = serialized;
            props.onInput(markdown);
        }
    }

    function readMarkdown(): string {
        flushMarkdown();
        // `lastExternalSource` is the canonical, source-preserving version of
        // the editor document. Serializing ProseMirror again here loses syntax
        // that the rich schema does not model (front matter, footnotes,
        // directives, and other opaque Markdown), especially when Save or
        // Export is invoked before switching back to Source mode.
        return lastExternalSource;
    }

    function serializeMarkdown(): string {
        return (
            editor?.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                return ctx.get(serializerCtx)(view.state.doc);
            }) ?? props.source()
        );
    }

    function currentEditor(): Editor | undefined {
        return editor;
    }

    async function createEditor(source: string, withMath: boolean): Promise<void> {
        if (host === undefined) return;
        const builder = new CrepeBuilder({ root: host, defaultValue: source });
        builder.addFeature(listItem).addFeature(linkTooltip).addFeature(table);
        if (withMath) {
            chemistryEnabled = containsChemistry(source);
            if (chemistryEnabled) await import("katex/contrib/mhchem");
            // Crepe's Latex feature requires its code-block renderer and
            // CodeMirror feature flag. Load it only with the math feature.
            const { codeMirror } = await import("@milkdown/crepe/feature/code-mirror");
            builder.addFeature(codeMirror);
            const { latex } = await import("@milkdown/crepe/feature/latex");
            builder.addFeature(latex, { katexOptions: { throwOnError: false } });
        } else chemistryEnabled = false;
        crepe = builder;
        editor = builder.editor;
        mathEnabled = withMath;
        await builder.create();
    }

    function syncEditorSurface(): void {
        if (editor === undefined) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        if (host !== undefined) {
            host.inert = !props.active();
            host.setAttribute("aria-hidden", String(!props.active()));
        }
        view.dom.setAttribute(
            "aria-label",
            props.active() ? "Markdown editor" : "Rich text editor"
        );
        view.dom.setAttribute("role", "textbox");
        view.dom.setAttribute("aria-multiline", "true");
        view.dom.id = props.active() ? "editor" : "rich-editor";
        view.dom.setAttribute("contenteditable", String(props.active()));
        view.dom.setAttribute("spellcheck", "true");
        props.onFocusReady?.(() => editor?.action((ctx) => ctx.get(editorViewCtx).focus()));
        props.onNavigateReady?.(navigateToText);
        if (observer !== undefined)
            observer.observe(view.dom, { childList: true, characterData: true, subtree: true });
        trackEditorSelection(view);
    }

    async function enableMath(): Promise<void> {
        await rebuildMathEditor("math");
    }

    async function enableChemistry(): Promise<void> {
        await rebuildMathEditor("chemistry");
    }

    async function rebuildMathEditor(feature: "math" | "chemistry"): Promise<void> {
        if (
            (feature === "math" && mathEnabled) ||
            (feature === "chemistry" && (!mathEnabled || chemistryEnabled)) ||
            enablingMath ||
            editor === undefined ||
            crepe === undefined ||
            host === undefined
        )
            return;

        enablingMath = true;
        const generation = ++rebuildGeneration;
        const editorHost = host;
        flushMarkdown();
        const source = readMarkdown();
        const previousEditor = editor;
        const previousCrepe = crepe;
        const previousView = previousEditor.action((ctx) => ctx.get(editorViewCtx));
        const previousDoc = previousView.state.doc;
        const selection = {
            anchor: previousView.state.selection.anchor,
            head: previousView.state.selection.head,
            focused: previousView.hasFocus(),
            scrollTop: previousView.dom.scrollTop,
            scrollLeft: previousView.dom.scrollLeft
        };
        let teardownStarted = feature === "math";
        previousView.dom.setAttribute("contenteditable", "false");
        editorHost.setAttribute("aria-busy", "true");
        observer?.disconnect();

        const isCurrent = () =>
            !destroying && generation === rebuildGeneration && host !== undefined;
        const restoreViewport = (view: EditorView, mapMath: boolean) => {
            if (mapMath) {
                restoreSelectionAcrossMath(previousDoc, view, selection.anchor, selection.head);
            } else {
                restoreSelection(view, selection.anchor, selection.head);
            }
            view.dom.scrollTop = selection.scrollTop;
            view.dom.scrollLeft = selection.scrollLeft;
            if (selection.focused && props.active()) view.focus();
        };
        const recordSourceBaseline = () => {
            lastExternalSource = source;
            fidelitySource = source;
            fidelityBaseline = serializeMarkdown();
            selectionMemory = undefined;
        };

        try {
            if (feature === "chemistry") {
                await import("katex/contrib/mhchem");
                if (!isCurrent()) return;
                teardownStarted = true;
            }
            await previousCrepe.destroy();
            if (!isCurrent()) return;
            editor = undefined;
            crepe = undefined;
            await createEditor(source, true);
            const upgradedEditor = currentEditor();
            if (!isCurrent() || upgradedEditor === undefined) return;
            syncEditorSurface();
            const upgradedView = upgradedEditor.action((ctx) => ctx.get(editorViewCtx));
            restoreViewport(upgradedView, feature === "math");
            recordSourceBaseline();
            setMathDiagnostic("");
        } catch (error) {
            if (feature === "chemistry" && !teardownStarted && editor !== undefined) {
                syncEditorSurface();
            } else {
                const failedCrepe = crepe;
                editor = undefined;
                crepe = undefined;
                try {
                    await failedCrepe?.destroy();
                } catch {
                    // Keep the source and preview available if plugin teardown fails.
                }
                if (isCurrent()) {
                    try {
                        await createEditor(source, false);
                        syncEditorSurface();
                        const fallbackView = currentEditor()?.action((ctx) =>
                            ctx.get(editorViewCtx)
                        );
                        if (fallbackView !== undefined) restoreViewport(fallbackView, false);
                        recordSourceBaseline();
                    } catch {
                        editor = undefined;
                        crepe = undefined;
                    }
                }
            }
            const featureLabel = feature === "math" ? "Math" : "Chemistry";
            setMathDiagnostic(
                error instanceof Error
                    ? `${featureLabel} editing could not be loaded: ${error.message}`
                    : `${featureLabel} editing could not be loaded. The source and preview remain available.`
            );
        } finally {
            editorHost.removeAttribute("aria-busy");
            enablingMath = false;
        }
    }

    function restoreSelection(view: EditorView, anchor: number, head: number): void {
        const size = view.state.doc.content.size;
        const safeAnchor = Math.max(0, Math.min(anchor, size));
        const safeHead = Math.max(0, Math.min(head, size));
        const doc = view.state.doc;
        const resolvedAnchor = TextSelection.near(doc.resolve(safeAnchor)).head;
        const resolvedHead = TextSelection.near(doc.resolve(safeHead)).head;
        view.dispatch(
            view.state.tr.setSelection(TextSelection.create(doc, resolvedAnchor, resolvedHead))
        );
    }

    /** Map selection offsets through markdown becoming one-node math atoms. */
    function restoreSelectionAcrossMath(
        previousDoc: ProseMirrorNode,
        view: EditorView,
        anchor: number,
        head: number
    ): void {
        const nextDoc = view.state.doc;
        restoreSelection(
            view,
            mapMathPosition(previousDoc, nextDoc, anchor),
            mapMathPosition(previousDoc, nextDoc, head)
        );
    }

    function mapMathPosition(
        previousDoc: ProseMirrorNode,
        nextDoc: ProseMirrorNode,
        position: number
    ): number {
        const sourceResolved = previousDoc.resolve(
            Math.max(0, Math.min(position, previousDoc.content.size))
        );
        const sourceBlock = sourceResolved.parent;
        if (!sourceBlock.isTextblock) return position;

        const sourceText = blockTextForMapping(sourceBlock);
        const comparableSource = normalizeBlockForSelection(sourceBlock, sourceText);
        const candidates: { readonly node: ProseMirrorNode; readonly position: number }[] = [];
        nextDoc.descendants((node, nodePosition) => {
            if (node.isTextblock) {
                const candidateText = blockTextForMapping(node);
                if (normalizeBlockForSelection(node, candidateText) === comparableSource) {
                    candidates.push({ node, position: nodePosition });
                }
            }
            return true;
        });
        if (candidates.length === 0) return position;

        const precedingSourceBlocks: string[] = [];
        previousDoc.descendants((node) => {
            if (!node.isTextblock) return true;
            if (node === sourceBlock) return false;
            const text = blockTextForMapping(node);
            precedingSourceBlocks.push(normalizeBlockForSelection(node, text));
            return true;
        });
        const ordinal = precedingSourceBlocks.filter((text) => text === comparableSource).length;
        const targetBlock = candidates[Math.min(ordinal, candidates.length - 1)];
        if (targetBlock === undefined) return position;
        if (isMathCodeBlock(sourceBlock)) {
            return (
                targetBlock.position +
                1 +
                Math.min(sourceResolved.parentOffset, targetBlock.node.content.size)
            );
        }

        const sourceOffset = isMathCodeBlock(sourceBlock)
            ? sourceResolved.parentOffset
            : sourceBlock.type.name === "code_block"
              ? sourceResolved.parentOffset
              : normalizedMathPrefixLength(sourceText, sourceResolved.parentOffset);
        let mappedOffset = 0;
        targetBlock.node.forEach((child, childOffset) => {
            if (childOffset >= sourceOffset) return;
            const width = child.isText
                ? (child.text?.length ?? 0)
                : child.type.name === "math_inline" || child.isLeaf
                  ? 1
                  : normalizeBlockForSelection(child, blockTextForMapping(child)).length;
            mappedOffset = childOffset + Math.min(width, sourceOffset - childOffset);
        });
        return targetBlock.position + 1 + mappedOffset;
    }

    function blockTextForMapping(block: ProseMirrorNode): string {
        if (isMathCodeBlock(block)) return "\uFFFC";
        let text = "";
        block.forEach((child) => {
            if (child.type.name === "math_inline") text += "\uFFFC";
            else if (child.isText) text += child.text ?? "";
            else if (child.isLeaf) text += "\uFFFC";
            else text += blockTextForMapping(child);
        });
        return text;
    }

    function isMathCodeBlock(block: ProseMirrorNode): boolean {
        if (block.type.name !== "code_block") return false;
        const language = String(block.attrs.language ?? "").toLowerCase();
        return language === "latex" || language === "math" || language === "tex";
    }

    function normalizeMathForSelection(text: string): string {
        const math = (prose: string): string =>
            prose.replace(
                /\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$\$[\s\S]+?\$\$|(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$/g,
                "\uFFFC"
            );
        const inlineCode = /(?<!\\)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
        let result = "";
        let cursor = 0;
        for (const match of text.matchAll(inlineCode)) {
            const start = match.index ?? cursor;
            result += math(text.slice(cursor, start)) + match[0];
            cursor = start + match[0].length;
        }
        return result + math(text.slice(cursor));
    }

    function normalizedMathPrefixLength(text: string, offset: number): number {
        const end = Math.max(0, Math.min(offset, text.length));
        const inlineCode = /(?<!\\)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
        let logicalLength = 0;
        let cursor = 0;
        for (const match of text.matchAll(inlineCode)) {
            const start = match.index ?? cursor;
            const codeEnd = start + match[0].length;
            if (end <= start)
                return logicalLength + normalizeMathForSelection(text.slice(cursor, end)).length;
            logicalLength += normalizeMathForSelection(text.slice(cursor, start)).length;
            if (end < codeEnd) return logicalLength + end - start;
            logicalLength += match[0].length;
            cursor = codeEnd;
        }
        return logicalLength + normalizeMathForSelection(text.slice(cursor, end)).length;
    }

    function normalizeBlockForSelection(block: ProseMirrorNode, text: string): string {
        if (block.type.name === "code_block") {
            if (!isMathCodeBlock(block)) return text;
        }
        return normalizeMathForSelection(text);
    }

    function navigateToText(query: string): void {
        if (editor === undefined || query.length === 0) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        const headings = Array.from(view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
        const heading = headings.find((candidate) => candidate.textContent?.trim() === query);
        let range: Range | undefined;
        if (heading !== undefined) {
            range = document.createRange();
            range.selectNodeContents(heading);
        } else {
            const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode()) !== null) {
                const offset = node.textContent?.indexOf(query) ?? -1;
                if (offset < 0) continue;
                range = document.createRange();
                range.setStart(node, offset);
                range.setEnd(node, offset + query.length);
                break;
            }
        }
        if (range === undefined) return;
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        (heading ?? range.startContainer.parentElement)?.scrollIntoView({ block: "center" });
        view.focus();
    }

    return (
        <div
            class="rich-editor"
            classList={{ "rich-editor--inactive": !props.active() }}
            ref={(element) => (root = element)}
        >
            <div
                class="rich-editor__toolbar"
                role="toolbar"
                aria-label="Text formatting"
                onMouseDown={(event) => event.preventDefault()}
            >
                <button
                    type="button"
                    aria-label="Heading 1"
                    title="Heading 1"
                    onClick={() => runCommand(wrapInHeadingCommand.key, 1)}
                >
                    H1
                </button>
                <button
                    type="button"
                    aria-label="Heading 2"
                    title="Heading 2"
                    onClick={() => runCommand(wrapInHeadingCommand.key, 2)}
                >
                    H2
                </button>
                <span aria-hidden="true" class="rich-editor__separator" />
                <button
                    type="button"
                    aria-label="Bold"
                    title="Bold"
                    onClick={() => runCommand(toggleStrongCommand.key)}
                >
                    <strong>B</strong>
                </button>
                <button
                    type="button"
                    aria-label="Italic"
                    title="Italic"
                    onClick={() => runCommand(toggleEmphasisCommand.key)}
                >
                    <em>I</em>
                </button>
                <button
                    type="button"
                    aria-label="Link"
                    title="Link"
                    onClick={() => {
                        const href = window.prompt("Link address");
                        if (href !== null) runCommand(toggleLinkCommand.key, { href });
                    }}
                >
                    Link
                </button>
                <button
                    type="button"
                    aria-label="Insert table"
                    title="Insert table"
                    onClick={() => runCommand(insertTableCommand.key, { row: 3, col: 3 })}
                >
                    Table
                </button>
                <button
                    type="button"
                    aria-label="Insert inline math"
                    title="Insert inline math"
                    onClick={() => {
                        const formula = window.prompt("LaTeX formula", "x^2");
                        if (formula !== null) insertAtSelection(`$${formula}$`);
                    }}
                >
                    Math
                </button>
                <button
                    type="button"
                    aria-label="Insert display equation"
                    title="Insert display equation"
                    onClick={() => {
                        const formula = window.prompt("Display equation", "\\sum_{i=1}^{n} x_i");
                        if (formula !== null) insertAtSelection(`\n$$\n${formula}\n$$\n`);
                    }}
                >
                    Equation
                </button>
                <button
                    type="button"
                    aria-label="Insert code block"
                    title="Insert code block"
                    onClick={() => {
                        const language = window.prompt("Code language", "text");
                        if (language !== null) insertAtSelection(`\n\`\`\`${language}\n\n\`\`\`\n`);
                    }}
                >
                    Code
                </button>
                <button
                    type="button"
                    aria-label="Insert image"
                    title="Insert image"
                    onClick={() => {
                        const url = window.prompt("Image path or URL");
                        if (url !== null) {
                            const alt = window.prompt("Image description", "") ?? "";
                            insertAtSelection(`![${alt}](${url})`);
                        }
                    }}
                >
                    Image
                </button>
                <button
                    type="button"
                    aria-label="Insert footnote"
                    title="Insert footnote"
                    onClick={() => {
                        const note = window.prompt("Footnote text");
                        if (note !== null) insertAtSelection(`[^1]\n\n[^1]: ${note}`);
                    }}
                >
                    Footnote
                </button>
            </div>
            <Show when={mathDiagnostic().length > 0}>
                <p class="rich-editor__diagnostic" role="status">
                    {mathDiagnostic()}
                </p>
            </Show>
            <div class="rich-editor__surface" ref={(element) => (host = element)} />
        </div>
    );
}

function looksLikeMarkdownDocument(source: string): boolean {
    if (/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.test(source)) return false;
    if (/^\s*\$\$|^\s*\\\[|^\s*```(?:math|tex)\b/im.test(source)) return false;
    if (
        /^\s{0,3}(?:#{1,6}\s|>`?\s?|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|\s*$|\[[^\]]+\]:)/m.test(source)
    ) {
        return true;
    }
    return /^\s{0,3}(?:\*\s*){3,}$/.test(source);
}

function containsMath(source: string): boolean {
    if (/^\s{0,3}(?:`{3,}|~{3,})\s*(?:math|tex|latex)\b/im.test(source)) return true;
    const prose = withoutCode(source);
    return (
        /\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(prose) ||
        /\$\$[\s\S]+?\$\$/.test(prose) ||
        /(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$/.test(prose)
    );
}

function containsChemistry(source: string): boolean {
    return /\\(?:ce|pu)\s*\{/.test(withoutCode(source));
}

function withoutCode(source: string): string {
    return source
        .replace(
            /^\s{0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\s{0,3}\1\s*$/gm,
            (_block, _fence: string, info: string, body: string) =>
                /\b(?:math|tex|latex)\b/i.test(info) ? body : ""
        )
        .replace(/(?<!\\)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");
}
