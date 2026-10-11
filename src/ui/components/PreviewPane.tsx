import {
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    Show,
    untrack
} from "solid-js";

import type { ApplicationContext } from "../../ApplicationContext";
import {
    PAGE_SIZES,
    PX_PER_MM,
    pageHeightPt,
    pageWidthPt,
    type PageSetup
} from "../../domain/PageSetup";
import { fontStack } from "../../domain/pdf/PdfMetrics";
import type { DrawOp, LaidOut } from "../../domain/pdf/PdfLayout";
import { parseBlocks } from "../../domain/pdf/PdfLayout";
import { paginate as paginateBlocks } from "../../domain/pdf/PdfPaginate";
import { resolveImages } from "../../domain/pdf/ImageDecode";
import { createPageFrame, createPageLabel } from "./Page";

export interface PreviewPaneProps {
    context: ApplicationContext;
    flowRef: (element: HTMLDivElement | undefined) => void;
    onFocusEditor: () => void;
}

const PAGE_GAP = 24;
const ZOOM = 0.75;
const PX_PER_PT = 96 / 72;
const PAPER = "#ffffff";

export function PreviewPane(props: PreviewPaneProps) {
    const store = props.context.previewStore;
    const settingsStore = props.context.settingsStore;

    let viewport: HTMLDivElement | undefined;
    let stack: HTMLDivElement | undefined;
    let flow: HTMLDivElement | undefined;

    // Each pass numbers itself, so a slow image decode cannot overwrite the
    // pages of a document the user has already moved on from.
    let generation = 0;

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

    // One snapshot per rendered document. The renderer keeps its own nodes for
    // the next incremental pass, so the preview works on copies taken once,
    // which keeps a settings change from re-reading a document that has moved.
    const staged = createMemo(() => {
        const rendered = store.current();
        if (rendered === null || rendered.isEmpty) {
            return null;
        }
        return [...rendered.prefix, ...Array.from(rendered.content.childNodes)].map((node) =>
            node.cloneNode(true)
        );
    });

    createEffect(() => {
        const nodes = staged();
        const settings = settingsStore.current();
        if (flow === undefined || stack === undefined) {
            return;
        }
        applyGeometry(settings, stack);
        if (nodes === null) {
            flow.replaceChildren();
            renderEmpty(untrack(activePage));
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const node of nodes) {
            fragment.appendChild(node);
        }
        flow.replaceChildren(fragment);
        void relayout(settings);
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
        void relayout(settingsStore.current());
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
        // The frames are behind the canvas, so the page under the pointer is
        // resolved from the click position instead of the target.
        if (stack === undefined) {
            return;
        }
        const total = store.pageCount();
        if (total === 0) {
            return;
        }
        const bounds = stack.getBoundingClientRect();
        const height = pagePixels(settingsStore.current()).height;
        const index = Math.floor((event.clientY - bounds.top) / (height + PAGE_GAP));
        focusPage(Math.min(total - 1, Math.max(0, index)));
    }

    /**
     * Paginates the rendered document with the same engine the PDF export
     * uses, then paints each page. The preview and the exported file therefore
     * break at the same words on the same pages.
     */
    async function relayout(settings: PageSetup): Promise<void> {
        if (flow === undefined || stack === undefined) {
            return;
        }
        const token = (generation += 1);
        const blocks = parseBlocks(flow);
        const decoded = await resolveImages(flow);
        if (token !== generation) {
            return;
        }
        const embeds = new Map<string, boolean>();
        for (const [src, bitmap] of decoded) {
            embeds.set(src, bitmap !== null);
        }
        const layout: LaidOut = paginateBlocks(blocks, settings, embeds);
        if (token !== generation) {
            return;
        }
        paint(layout, settings, decoded, untrack(activePage));
        store.setPageCount(layout.pages.length);
    }

    function paint(
        layout: LaidOut,
        settings: PageSetup,
        decoded: ReadonlyMap<string, ImageBitmap | null>,
        active: number
    ): void {
        if (stack === undefined) {
            return;
        }
        for (const element of Array.from(stack.querySelectorAll(".page-frame, .page-label"))) {
            element.remove();
        }
        const page = pagePixels(settings);
        layout.pages.forEach((ops, index) => {
            const frame = createPageFrame({
                index,
                total: layout.pages.length,
                active: index === active,
                onActivate: (element) => {
                    setActivePage(index);
                    element.focus();
                }
            });
            frame.style.top = `${index * (page.height + PAGE_GAP)}px`;
            const canvas = document.createElement("canvas");
            canvas.className = "page-canvas";
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", `Page ${index + 1} preview`);
            frame.appendChild(canvas);
            stack?.appendChild(frame);
            paintPage(canvas, ops, layout, settings, decoded);

            const label = createPageLabel(index, layout.pages.length);
            label.style.top = `${index * (page.height + PAGE_GAP) + page.height + 4}px`;
            stack?.appendChild(label);
        });
        const total = layout.pages.length;
        const height = (total - 1) * (page.height + PAGE_GAP) + page.height + 24;
        stack.style.height = `${height}px`;
        if (viewport !== undefined) {
            viewport.style.height = `${height * ZOOM}px`;
        }
    }

    function renderEmpty(active: number): void {
        if (stack === undefined) {
            return;
        }
        for (const element of Array.from(stack.querySelectorAll(".page-frame, .page-label"))) {
            element.remove();
        }
        const page = pagePixels(settingsStore.current());
        const frame = createPageFrame({
            index: 0,
            total: 1,
            active: active === 0,
            onActivate: (element) => {
                setActivePage(0);
                element.focus();
            }
        });
        frame.style.top = "0px";
        frame.appendChild(createEmptyState());
        stack.appendChild(frame);

        const label = createPageLabel(0, 1);
        label.style.top = `${page.height + 4}px`;
        stack.appendChild(label);
        stack.style.height = `${page.height + 24}px`;
        if (viewport !== undefined) {
            viewport.style.height = `${(page.height + 24) * ZOOM}px`;
        }
        store.setPageCount(0);
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

function createEmptyState(): HTMLParagraphElement {
    const placeholder = document.createElement("p");
    placeholder.className = "preview__placeholder";
    placeholder.textContent = "Your document will appear here.";
    return placeholder;
}

function pagePixels(settings: PageSetup): { width: number; height: number } {
    const size = PAGE_SIZES[settings.pageSize];
    return {
        width: Math.round(size.widthMm * PX_PER_MM),
        height: Math.round(size.heightMm * PX_PER_MM)
    };
}

// The page geometry reaches the frames through custom properties; the height
// also decides where the labels and the next page start.
function applyGeometry(settings: PageSetup, stack: HTMLElement): void {
    const page = pagePixels(settings);
    stack.style.setProperty("--page-width", `${page.width}px`);
    stack.style.setProperty("--page-height", `${page.height}px`);
}

function grayCss(value: number): string {
    const channel = Math.round(Math.max(0, Math.min(1, value)) * 255);
    return `rgb(${channel}, ${channel}, ${channel})`;
}

/**
 * Paints one page in the PDF's own coordinate system: points, with the origin
 * at the bottom left. The canvas transform turns that into pixels.
 */
function paintPage(
    canvas: HTMLCanvasElement,
    ops: readonly DrawOp[],
    layout: LaidOut,
    settings: PageSetup,
    decoded: ReadonlyMap<string, ImageBitmap | null>
): void {
    const page = pagePixels(settings);
    const widthPt = pageWidthPt(settings);
    const heightPt = pageHeightPt(settings);
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(page.width * scale);
    canvas.height = Math.round(page.height * scale);
    canvas.style.width = `${page.width}px`;
    canvas.style.height = `${page.height}px`;
    const context = canvas.getContext("2d");
    if (context === null) {
        return;
    }
    // Points up the page, canvas pixels down it. The transform only scales, so
    // glyphs and images stay upright, and every op flips its own y: a rect or
    // an image is placed by its upper edge, which in the op's space is its
    // bottom edge plus its height.
    context.setTransform(PX_PER_PT * scale, 0, 0, PX_PER_PT * scale, 0, 0);
    const down = (value: number): number => heightPt - value;
    context.fillStyle = PAPER;
    context.fillRect(0, 0, widthPt, heightPt);

    for (const op of ops) {
        switch (op.kind) {
            case "text": {
                context.fillStyle = grayCss(op.gray);
                context.font = `${op.font.italic ? "italic " : ""}${op.font.bold ? "bold " : ""}${op.size}pt ${fontStack(op.font)}`;
                context.fillText(op.text, op.x, down(op.y));
                break;
            }
            case "rect": {
                context.fillStyle = grayCss(op.gray);
                context.fillRect(op.x, down(op.y + op.h), op.w, op.h);
                break;
            }
            case "line": {
                context.strokeStyle = grayCss(op.gray);
                context.lineWidth = op.width;
                context.beginPath();
                context.moveTo(op.x1, down(op.y1));
                context.lineTo(op.x2, down(op.y2));
                context.stroke();
                break;
            }
            case "image": {
                const src = layout.images[op.index]?.src ?? "";
                const bitmap = decoded.get(src);
                if (bitmap !== undefined && bitmap !== null) {
                    context.drawImage(bitmap, op.x, down(op.y + op.h), op.w, op.h);
                }
                break;
            }
            case "link":
                // The underline is a rect operation; the target only matters in
                // the exported file.
                break;
        }
    }
}
