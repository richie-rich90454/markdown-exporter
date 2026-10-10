export interface PageFrameOptions {
    readonly index: number;
    readonly total: number;
    readonly active: boolean;
    readonly onActivate: (element: HTMLDivElement) => void;
}

export function createPageFrame(options: PageFrameOptions): HTMLDivElement {
    const frame = document.createElement("div");
    frame.className = "page-frame";
    frame.dataset.pageIndex = String(options.index);
    frame.dataset.active = String(options.active);
    frame.tabIndex = options.active ? 0 : -1;
    frame.setAttribute("role", "group");
    frame.setAttribute("aria-label", `Page ${options.index + 1} of ${options.total}`);
    frame.addEventListener("mousedown", () => options.onActivate(frame));
    frame.addEventListener("focus", () => options.onActivate(frame));
    return frame;
}

export function createPageLabel(index: number, total: number): HTMLSpanElement {
    const label = document.createElement("span");
    label.className = "page-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = `Page ${index + 1} of ${total}`;
    return label;
}
