import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import { PAGE_SIZES, type PageSettings } from "../../state/SettingsStore";
import { createPageFrame, createPageLabel } from "./Page";

export interface PreviewPaneProps {
    context: ApplicationContext;
    flowRef: (element: HTMLDivElement | undefined) => void;
    onFocusEditor: () => void;
}

const ZOOM = 0.75;
const BLOCK_GAP = 12;
const PAGE_GAP = 24;
const PX_PER_MM = 96 / 25.4;
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

export function PreviewPane(props: PreviewPaneProps) {
    const store = props.context.previewStore;
    const settingsStore = props.context.settingsStore;

    let viewport: HTMLDivElement | undefined;
    let stack: HTMLDivElement | undefined;
    let flow: HTMLDivElement | undefined;

    const [activePage, setActivePage] = createSignal(0);
    const [slow, setSlow] = createSignal(false);

    createEffect(() => {
        if (!store.isRendering()) {
            setSlow(false);
            return;
        }
        // Under 100 ms nothing appears; a spinner would flash and vanish.
        const timer = setTimeout(() => setSlow(true), 100);
        onCleanup(() => clearTimeout(timer));
    });

    createEffect(() => {
        const rendered = store.current();
        const settings = settingsStore.current();
        if (flow === undefined || stack === undefined) {
            return;
        }
        applyGeometry(settings, stack, flow);
        if (rendered === null || rendered.isEmpty) {
            flow.replaceChildren(createEmptyState());
        } else {
            const fragment = document.createDocumentFragment();
            for (const node of rendered.prefix) {
                fragment.appendChild(node);
            }
            for (const node of Array.from(rendered.content.childNodes)) {
                fragment.appendChild(node);
            }
            flow.replaceChildren(fragment);
        }
        paginate(untrack(activePage));
    });

    createEffect(() => {
        const active = activePage();
        if (stack === undefined) {
            return;
        }
        for (const frame of Array.from(stack.querySelectorAll<HTMLElement>(".page-frame"))) {
            const index = Number(frame.dataset.pageIndex ?? "0");
            frame.tabIndex = index === active ? 0 : -1;
            frame.dataset.active = String(index === active);
        }
    });

    onMount(() => {
        if (flow === undefined) {
            return;
        }
        // Images report load after the first layout, so pagination is repeated.
        flow.addEventListener("load", onMediaLoad, true);
    });

    onCleanup(() => {
        flow?.removeEventListener("load", onMediaLoad, true);
    });

    function onMediaLoad(): void {
        paginate(activePage());
    }

    function onStackKeyDown(event: KeyboardEvent): void {
        const total = store.pageCount();
        if (total === 0) {
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const active = activePage();
            const next =
                event.key === "ArrowDown"
                    ? Math.min(active + 1, total - 1)
                    : Math.max(active - 1, 0);
            focusPage(next);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            props.onFocusEditor();
        }
    }

    function focusPage(index: number): void {
        setActivePage(index);
        const frame = stack?.querySelector<HTMLElement>(`.page-frame[data-page-index="${index}"]`);
        frame?.focus();
    }

    function onStackClick(event: MouseEvent): void {
        // The content sits in front of the page frames, so the page under the
        // pointer is resolved from the click position instead of the target.
        if (stack === undefined) {
            return;
        }
        const total = store.pageCount();
        if (total === 0) {
            return;
        }
        const bounds = stack.getBoundingClientRect();
        const page = pagePixels(settingsStore.current());
        const index = Math.floor((event.clientY - bounds.top) / (page.height + PAGE_GAP));
        focusPage(Math.min(total - 1, Math.max(0, index)));
    }

    /**
     * Splits the rendered blocks into page frames.
     *
     * Blocks are never split, headings never end a page alone, and the nodes
     * stay children of the flow element: pagination only inserts spacer
     * elements and positions the frames, so the incremental renderer keeps its
     * node identity across renders.
     */
    function paginate(active: number): void {
        if (stack === undefined || flow === undefined || viewport === undefined) {
            return;
        }
        const settings = settingsStore.current();
        const page = pagePixels(settings);

        for (const spacer of Array.from(flow.querySelectorAll(".page-spacer"))) {
            spacer.remove();
        }
        for (const element of Array.from(stack.querySelectorAll(".page-frame, .page-label"))) {
            element.remove();
        }

        const blocks = Array.from(flow.children) as HTMLElement[];
        const heights = blocks.map((block) => block.getBoundingClientRect().height);
        const capacity = page.height - 2 * page.margin;

        const starts: number[] = [];
        let used = 0;
        for (let index = 0; index < blocks.length; index += 1) {
            const height = heights[index] ?? 0;
            const before = used === 0 ? 0 : BLOCK_GAP;
            if (used > 0 && used + before + height > capacity) {
                starts.push(index);
                used = height;
                continue;
            }
            used += before + height;
        }

        // A heading never sits alone at the bottom of a page.
        for (let index = starts.length - 1; index >= 0; index -= 1) {
            let start = starts[index] ?? 0;
            while (start > 0 && isHeading(blocks[start - 1])) {
                start -= 1;
            }
            starts[index] = start;
        }

        const pageStarts = new Set(starts);
        let cursor = 0;
        let pageIndex = 0;
        for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index];
            if (block === undefined) {
                continue;
            }
            if (pageStarts.has(index)) {
                const spacer = document.createElement("div");
                spacer.className = "page-spacer";
                spacer.style.height = `${Math.max(0, page.height + PAGE_GAP - cursor)}px`;
                flow.insertBefore(spacer, block);
                pageIndex += 1;
                cursor = 0;
            }
            cursor += (cursor === 0 ? 0 : BLOCK_GAP) + (heights[index] ?? 0);
        }

        const total = pageIndex + 1;
        for (let index = 0; index < total; index += 1) {
            const top = index * (page.height + PAGE_GAP);
            const frame = createPageFrame({
                index,
                total,
                active: index === active,
                onActivate: (element) => {
                    setActivePage(index);
                    element.focus();
                }
            });
            frame.style.top = `${top}px`;
            frame.style.height = `${page.height}px`;
            stack?.appendChild(frame);

            const label = createPageLabel(index, total);
            label.style.top = `${top + page.height + 4}px`;
            stack?.appendChild(label);
        }

        const stackHeight = (total - 1) * (page.height + PAGE_GAP) + page.height + 24;
        stack.style.height = `${stackHeight}px`;
        viewport.style.height = `${stackHeight * ZOOM}px`;
        store.setPageCount(total);
    }

    return (
        <section class="pane pane--preview" aria-label="Preview">
            <ShowProgress active={slow() && store.isRendering()} />
            <Show when={store.lastError() !== null}>
                <p class="preview__error" role="status">
                    {store.lastError()}
                </p>
            </Show>
            <div
                class="preview"
                ref={(element) => {
                    viewport = element;
                }}
            >
                <div class="preview__zoomer">
                    <div
                        class="preview__stack"
                        ref={(element) => {
                            stack = element;
                        }}
                        onKeyDown={(event) => onStackKeyDown(event)}
                        onClick={(event) => onStackClick(event)}
                    >
                        <div
                            class="preview__flow"
                            ref={(element) => {
                                flow = element;
                                props.flowRef(element);
                            }}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}

function ShowProgress(props: { active: boolean }) {
    return (
        <div
            class="preview__progress"
            classList={{ "is-active": props.active }}
            aria-hidden="true"
        />
    );
}

function createEmptyState(): HTMLDivElement {
    const placeholder = document.createElement("div");
    placeholder.className = "preview__placeholder";
    placeholder.textContent = "Your document will appear here.";
    return placeholder;
}

function isHeading(element: HTMLElement | undefined): boolean {
    return element !== undefined && HEADING_TAGS.has(element.tagName);
}

function pagePixels(settings: PageSettings): { width: number; height: number; margin: number } {
    const size = PAGE_SIZES[settings.pageSize];
    return {
        width: size.widthMm * PX_PER_MM,
        height: size.heightMm * PX_PER_MM,
        margin: settings.marginMm * PX_PER_MM
    };
}

function applyGeometry(settings: PageSettings, stack: HTMLElement, flow: HTMLElement): void {
    const page = pagePixels(settings);
    stack.style.setProperty("--page-width", `${page.width}px`);
    stack.style.setProperty("--page-height", `${page.height}px`);
    stack.style.setProperty("--page-margin", `${page.margin}px`);
    flow.style.setProperty("--preview-font-family", fontFamilyStack(settings.fontFamily));
    flow.style.setProperty("--preview-font-size", `${(settings.fontSizePt * 4) / 3}px`);
    flow.style.setProperty("--preview-line-height", `${settings.lineHeight}`);
    applyPageRule(settings);
}

function fontFamilyStack(family: PageSettings["fontFamily"]): string {
    if (family === "sans") {
        return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    }
    if (family === "mono") {
        return "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
    }
    return 'Georgia, "Times New Roman", serif';
}

let pageRule: HTMLStyleElement | undefined;

function applyPageRule(settings: PageSettings): void {
    const size = PAGE_SIZES[settings.pageSize];
    const rule = `@page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: ${settings.marginMm}mm; }`;
    if (pageRule === undefined) {
        pageRule = document.createElement("style");
        pageRule.id = "page-rule";
        document.head.appendChild(pageRule);
    }
    pageRule.textContent = rule;
}
