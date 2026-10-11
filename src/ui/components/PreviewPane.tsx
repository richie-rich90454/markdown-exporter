import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import { PAGE_SIZES, type PageSetup } from "../../domain/PageSetup";
import { createPageFrame, createPageLabel } from "./Page";

export interface PreviewPaneProps {
    context: ApplicationContext;
    flowRef: (element: HTMLDivElement | undefined) => void;
    onFocusEditor: () => void;
}

const ZOOM = 0.75;
const BLOCK_GAP = 12;
const PAGE_GAP = 24;
const MIN_FILL = 96;
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
            restoreSplits();
            flow.replaceChildren(createEmptyState());
        } else {
            // Any split from the previous pass goes back together first, so the
            // nodes the renderer still owns are mounted whole.
            restoreSplits();
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
     * Walks the rendered blocks into pages.
     *
     * A block that does not fit is moved to the next page, or split at its own
     * children when what is left of the current page is worth using. Splits are
     * undone again before every pass, so the incremental renderer keeps the
     * node tree it created.
     */
    function paginate(active: number): void {
        if (stack === undefined || flow === undefined || viewport === undefined) {
            return;
        }
        restoreSplits();
        const settings = settingsStore.current();
        const page = pagePixels(settings);
        const capacity = page.height - 2 * page.margin;

        for (const spacer of Array.from(flow.querySelectorAll(".page-spacer"))) {
            spacer.remove();
        }
        for (const element of Array.from(stack.querySelectorAll(".page-frame, .page-label"))) {
            element.remove();
        }

        const queue: HTMLElement[] = Array.from(flow.children) as HTMLElement[];
        const pages: HTMLElement[][] = [[]];
        const used: number[] = [0];

        while (queue.length > 0) {
            const block = queue.shift();
            if (block === undefined) {
                continue;
            }
            const height = block.offsetHeight;
            const current = pages[pages.length - 1] ?? [];
            const before = current.length === 0 ? 0 : BLOCK_GAP;
            const room = capacity - (used[used.length - 1] ?? 0) - before;

            if (height <= room || (isHeading(block) && height <= room - MIN_FILL)) {
                current.push(block);
                used[used.length - 1] = (used[used.length - 1] ?? 0) + before + height;
                continue;
            }

            // Otherwise try to fill the rest of this page with part of it.
            const pieces = room >= MIN_FILL ? splitBlock(block, room) : null;
            const head = pieces?.[0];
            if (
                pieces !== null &&
                pieces.length > 1 &&
                head !== undefined &&
                head.offsetHeight <= room
            ) {
                current.push(head);
                queue.unshift(...pieces.slice(1));
            } else if (pieces !== null && pieces.length > 1) {
                // The first piece is taller than what is left, so all of them
                // get another turn on the next page.
                queue.unshift(...pieces);
            } else if (current.length === 0) {
                // Nothing left to try on a fresh page: place it and let the
                // page frame clip what does not fit.
                current.push(block);
                used[used.length - 1] = height;
            } else {
                queue.unshift(block);
            }

            pages.push([]);
            used.push(0);
        }

        const host = flow;
        let cursor = 0;
        pages.forEach((blocks, index) => {
            for (const block of blocks) {
                if (cursor > 0) {
                    cursor += BLOCK_GAP;
                }
                cursor += block.offsetHeight;
            }
            if (index < pages.length - 1) {
                const spacer = document.createElement("div");
                spacer.className = "page-spacer";
                spacer.style.height = `${Math.max(0, page.height + PAGE_GAP - cursor)}px`;
                const last = blocks[blocks.length - 1];
                host.insertBefore(spacer, last === undefined ? null : last.nextSibling);
                cursor = 0;
            }
        });

        const total = pages.length;
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

const splits = new Map<HTMLElement, HTMLElement[]>();

// Moves every child back into the element it came from, innermost split first.
function restoreSplits(): void {
    for (const element of Array.from(splits.keys()).reverse()) {
        const wrappers = splits.get(element) ?? [];
        const first = wrappers[0];
        // The split detached the original element, so it has to take the place
        // of its own first wrapper again before its children come home.
        if (first !== undefined && first.parentNode !== null) {
            first.parentNode.insertBefore(element, first);
        }
        for (const wrapper of wrappers) {
            for (const child of Array.from(wrapper.childNodes)) {
                element.appendChild(child);
            }
            wrapper.remove();
        }
        splits.delete(element);
    }
}

function wrapperLike(element: HTMLElement): HTMLElement {
    const clone = document.createElement(element.tagName.toLowerCase());
    clone.className = element.className;
    const style = element.getAttribute("style");
    if (style !== null) {
        clone.setAttribute("style", style);
    }
    for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith("data-")) {
            clone.setAttribute(attribute.name, attribute.value);
        }
    }
    return clone;
}

// A wrapper takes children until it no longer fits, then the next one opens.
function splitBlock(element: HTMLElement, capacity: number): HTMLElement[] | null {
    if (element.tagName === "TABLE") {
        return splitRows(element, capacity);
    }
    if (element.tagName === "PRE") {
        return splitLines(element, capacity);
    }
    if (element.tagName === "BLOCKQUOTE" || element.tagName === "UL" || element.tagName === "OL") {
        return splitChildren(element, capacity);
    }
    return null;
}

function splitChildren(element: HTMLElement, capacity: number): HTMLElement[] | null {
    const children = Array.from(element.children) as HTMLElement[];
    const parent = element.parentNode;
    if (children.length < 2 || parent === null) {
        return null;
    }
    const wrappers: HTMLElement[] = [];
    let wrapper = wrapperLike(element);
    parent.insertBefore(wrapper, element);
    wrappers.push(wrapper);
    for (const child of children) {
        wrapper.appendChild(child);
        if (wrapper.offsetHeight > capacity && wrapper.children.length > 1) {
            const last = wrapper.lastElementChild;
            if (last === null) {
                continue;
            }
            last.remove();
            wrapper = wrapperLike(element);
            parent.insertBefore(wrapper, element);
            wrappers.push(wrapper);
            wrapper.appendChild(last);
        }
    }
    element.remove();
    splits.set(element, wrappers);
    return wrappers;
}

function splitLines(element: HTMLElement, capacity: number): HTMLElement[] | null {
    const parent = element.parentNode;
    const lines = (element.textContent ?? "").split("\n");
    if (parent === null || lines.length < 2) {
        return null;
    }
    const wrappers: HTMLElement[] = [];
    let carry: string[] = [];

    const flush = (): void => {
        const wrapper = wrapperLike(element);
        wrapper.textContent = carry.join("\n");
        parent.insertBefore(wrapper, element);
        wrappers.push(wrapper);
        carry = [];
    };

    for (const line of lines) {
        carry.push(line);
        const probe = wrapperLike(element);
        probe.textContent = carry.join("\n");
        parent.insertBefore(probe, element);
        const tooTall = probe.offsetHeight > capacity;
        probe.remove();
        if (!tooTall) {
            continue;
        }
        if (carry.length > 1) {
            carry.pop();
            flush();
            carry.push(line);
        } else {
            flush();
        }
    }
    if (carry.length > 0) {
        flush();
    }
    element.remove();
    splits.set(element, wrappers);
    return wrappers;
}

function splitRows(element: HTMLElement, capacity: number): HTMLElement[] | null {
    const parent = element.parentNode;
    const header = element.querySelector("thead tr") ?? null;
    const rows = Array.from(element.querySelectorAll("tbody tr"));
    if (parent === null || rows.length < 2) {
        return null;
    }
    const wrappers: HTMLElement[] = [];

    const open = (): HTMLElement => {
        const wrapper = wrapperLike(element);
        if (header !== null) {
            const head = document.createElement("thead");
            head.appendChild(header.cloneNode(true));
            wrapper.appendChild(head);
        }
        parent.insertBefore(wrapper, element);
        wrappers.push(wrapper);
        return wrapper;
    };

    let wrapper = open();
    for (const row of rows) {
        wrapper.appendChild(row);
        if (wrapper.offsetHeight > capacity && wrapper.querySelectorAll("tbody tr").length > 1) {
            row.remove();
            wrapper = open();
            wrapper.appendChild(row);
        }
    }
    element.remove();
    splits.set(element, wrappers);
    return wrappers;
}

function pagePixels(settings: PageSetup): { width: number; height: number; margin: number } {
    const size = PAGE_SIZES[settings.pageSize];
    return {
        width: size.widthMm * PX_PER_MM,
        height: size.heightMm * PX_PER_MM,
        margin: settings.marginMm * PX_PER_MM
    };
}

function applyGeometry(settings: PageSetup, stack: HTMLElement, flow: HTMLElement): void {
    const page = pagePixels(settings);
    stack.style.setProperty("--page-width", `${page.width}px`);
    stack.style.setProperty("--page-height", `${page.height}px`);
    stack.style.setProperty("--page-margin", `${page.margin}px`);
    flow.style.setProperty("--preview-font-family", fontFamilyStack(settings.fontFamily));
    flow.style.setProperty("--preview-font-size", `${(settings.fontSizePt * 4) / 3}px`);
    flow.style.setProperty("--preview-line-height", `${settings.lineHeight}`);
}

function fontFamilyStack(family: PageSetup["fontFamily"]): string {
    if (family === "sans") {
        return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    }
    if (family === "mono") {
        return "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
    }
    return 'Georgia, "Times New Roman", serif';
}
