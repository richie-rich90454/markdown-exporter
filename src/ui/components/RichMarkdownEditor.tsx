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
    let host: HTMLDivElement | undefined;
    let editor: Editor | undefined;
    let crepe: CrepeBuilder | undefined;
    let observer: MutationObserver | undefined;
    let destroying = false;
    let lastExternalSource = "";
    let fidelitySource = "";
    let fidelityBaseline = "";
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let mathEnabled = false;
    let enablingMath = false;

    onMount(() => {
        if (host === undefined) return;
        const initial = props.source();
        lastExternalSource = initial;
        fidelitySource = initial;
        mathEnabled = containsMath(initial);
        void createEditor(initial, mathEnabled).then(() => {
            if (destroying || editor === undefined) return;
            fidelityBaseline = serializeMarkdown();
            syncEditorSurface();
            props.onSourceReady?.(() =>
                readMarkdown()
            );
            props.onNavigateReady?.(navigateToText);
            const view = editor.action((ctx) => ctx.get(editorViewCtx));
            observer = new MutationObserver(scheduleMarkdownSync);
            observer.observe(view.dom, { childList: true, characterData: true, subtree: true });
            if (props.active() && document.activeElement === document.body) view.focus();
        });
    });

    createEffect(() => {
        const next = props.source();
        if (editor === undefined || next === lastExternalSource) return;
        lastExternalSource = next;
        fidelitySource = next;
        dirty = false;
        observer?.disconnect();
        editor.action(replaceAll(next));
        fidelityBaseline = serializeMarkdown();
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        observer?.observe(view.dom, { childList: true, characterData: true, subtree: true });
    });

    createEffect(() => {
        const active = props.active();
        if (host === undefined) return;
        host.inert = !active;
        host.setAttribute("aria-hidden", String(!active));
        const content = host.querySelector<HTMLElement>(".ProseMirror");
        content?.setAttribute("aria-label", active ? "Markdown editor" : "Rich text editor");
        if (content !== null && content !== undefined) content.id = active ? "editor" : "rich-editor";
        content?.setAttribute("contenteditable", String(active));
    });

    onCleanup(() => {
        destroying = true;
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
        editor?.action((ctx) => ctx.get(commandsCtx).call(command as never, payload as never));
    }

    function pasteMarkdown(event: ClipboardEvent): void {
        const source = event.clipboardData?.getData("text/plain") ?? "";
        if (source.length === 0 || !looksLikeMarkdownDocument(source)) return;
        event.preventDefault();
        editor?.action(insert(source));
    }

    function scheduleMarkdownSync(): void {
        if (syncTimer !== undefined) clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            flushMarkdown();
            if (!mathEnabled && containsMath(readMarkdown())) void enableMath();
        }, 120);
    }

    function onKeyDown(event: KeyboardEvent): void {
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key === "z") {
            event.preventDefault();
            flushMarkdown();
            props.onUndo(event.shiftKey);
        } else if (key === "y") {
            event.preventDefault();
            flushMarkdown();
            props.onUndo(true);
        } else if (key === "s") {
            event.preventDefault();
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
            dirty = true;
            lastExternalSource = markdown;
            fidelitySource = markdown;
            fidelityBaseline = serialized;
            props.onInput(markdown);
        }
    }

    function readMarkdown(): string {
        return dirty ? serializeMarkdown() : lastExternalSource;
    }

    function serializeMarkdown(): string {
        return editor?.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            return ctx.get(serializerCtx)(view.state.doc);
        }) ?? props.source();
    }

    async function createEditor(source: string, withMath: boolean): Promise<void> {
        if (host === undefined) return;
        const builder = new CrepeBuilder({ root: host, defaultValue: source });
        builder.addFeature(listItem).addFeature(linkTooltip).addFeature(table);
        if (withMath) {
            const { latex } = await import("@milkdown/crepe/feature/latex");
            builder.addFeature(latex, { katexOptions: { throwOnError: false } });
        }
        crepe = builder;
        editor = builder.editor;
        mathEnabled = withMath;
        await builder.create();
    }

    function syncEditorSurface(): void {
        if (editor === undefined) return;
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        view.dom.setAttribute("aria-label", props.active() ? "Markdown editor" : "Rich text editor");
        view.dom.id = props.active() ? "editor" : "rich-editor";
        view.dom.setAttribute("spellcheck", "true");
        props.onFocusReady?.(() => editor?.action((ctx) => ctx.get(editorViewCtx).focus()));
        props.onNavigateReady?.(navigateToText);
        if (observer !== undefined) observer.observe(view.dom, { childList: true, characterData: true, subtree: true });
    }

    async function enableMath(): Promise<void> {
        if (mathEnabled || enablingMath || editor === undefined || crepe === undefined || host === undefined) return;
        enablingMath = true;
        const source = readMarkdown();
        const view = editor.action((ctx) => ctx.get(editorViewCtx));
        const anchor = view.state.selection.anchor;
        const shouldFocus = view.hasFocus();
        observer?.disconnect();
        try {
            await crepe.destroy();
            if (destroying || host === undefined) return;
            await createEditor(source, true);
            if (editor === undefined) return;
            syncEditorSurface();
            const upgradedView = editor.action((ctx) => ctx.get(editorViewCtx));
            const position = Math.min(anchor, upgradedView.state.doc.content.size);
            upgradedView.dispatch(
                upgradedView.state.tr.setSelection(
                    TextSelection.near(upgradedView.state.doc.resolve(position))
                )
            );
            if (shouldFocus) upgradedView.focus();
            lastExternalSource = source;
            fidelitySource = source;
            fidelityBaseline = serializeMarkdown();
            setMathDiagnostic("");
        } catch (error) {
            setMathDiagnostic(error instanceof Error
                ? `Math editing could not be loaded: ${error.message}`
                : "Math editing could not be loaded. The source and preview remain available.");
        } finally {
            enablingMath = false;
        }
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
            onKeyDown={onKeyDown}
            onPaste={pasteMarkdown}
        >
            <div class="rich-editor__toolbar" role="toolbar" aria-label="Text formatting" onMouseDown={(event) => event.preventDefault()}>
                <button type="button" aria-label="Heading 1" title="Heading 1" onClick={() => runCommand(wrapInHeadingCommand.key, 1)}>H1</button>
                <button type="button" aria-label="Heading 2" title="Heading 2" onClick={() => runCommand(wrapInHeadingCommand.key, 2)}>H2</button>
                <span aria-hidden="true" class="rich-editor__separator" />
                <button type="button" aria-label="Bold" title="Bold" onClick={() => runCommand(toggleStrongCommand.key)}><strong>B</strong></button>
                <button type="button" aria-label="Italic" title="Italic" onClick={() => runCommand(toggleEmphasisCommand.key)}><em>I</em></button>
                <button type="button" aria-label="Link" title="Link" onClick={() => {
                    const href = window.prompt("Link address");
                    if (href !== null) runCommand(toggleLinkCommand.key, { href });
                }}>Link</button>
                <button type="button" aria-label="Insert table" title="Insert table" onClick={() => runCommand(insertTableCommand.key, { row: 3, col: 3 })}>Table</button>
                <button type="button" aria-label="Insert inline math" title="Insert inline math" onClick={() => {
                    const formula = window.prompt("LaTeX formula", "x^2");
                    if (formula !== null) editor?.action(insert(`$${formula}$`));
                }}>Math</button>
                <button type="button" aria-label="Insert display equation" title="Insert display equation" onClick={() => {
                    const formula = window.prompt("Display equation", "\\sum_{i=1}^{n} x_i");
                    if (formula !== null) editor?.action(insert(`\n$$\n${formula}\n$$\n`));
                }}>Equation</button>
                <button type="button" aria-label="Insert code block" title="Insert code block" onClick={() => {
                    const language = window.prompt("Code language", "text");
                    if (language !== null) editor?.action(insert(`\n\`\`\`${language}\n\n\`\`\`\n`));
                }}>Code</button>
                <button type="button" aria-label="Insert image" title="Insert image" onClick={() => {
                    const url = window.prompt("Image path or URL");
                    if (url !== null) {
                        const alt = window.prompt("Image description", "") ?? "";
                        editor?.action(insert(`![${alt}](${url})`));
                    }
                }}>Image</button>
                <button type="button" aria-label="Insert footnote" title="Insert footnote" onClick={() => {
                    const note = window.prompt("Footnote text");
                    if (note !== null) editor?.action(insert(`[^1]\n\n[^1]: ${note}`));
                }}>Footnote</button>
            </div>
            <Show when={mathDiagnostic().length > 0}>
                <p class="rich-editor__diagnostic" role="status">{mathDiagnostic()}</p>
            </Show>
            <div class="rich-editor__surface" ref={(element) => (host = element)} />
        </div>
    );
}

function looksLikeMarkdownDocument(source: string): boolean {
    if (/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.test(source)) return false;
    if (/^\s*\$\$|^\s*\\\[|^\s*```(?:math|tex)\b/im.test(source)) return false;
    if (/^\s{0,3}(?:#{1,6}\s|>`?\s?|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|\s*$|\[[^\]]+\]:)/m.test(source)) {
        return true;
    }
    return /^\s{0,3}(?:\*\s*){3,}$/.test(source);
}

function containsMath(source: string): boolean {
    return (
        /^\s{0,3}(?:`{3,}|~{3,})\s*math\b/im.test(source) ||
        /\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(source) ||
        /\$\$[\s\S]+?\$\$/.test(source) ||
        /(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$/.test(source)
    );
}
