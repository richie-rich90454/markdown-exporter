export interface MathGlyph {
    readonly text: string;
    readonly font: string;
    readonly x: number;
    readonly y: number;
    readonly size: number;
}

export interface MathRule {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface MathPreviewLayout {
    readonly element: HTMLElement;
    readonly fontSize: number;
    readonly width: number;
    readonly height: number;
    /** Original CSS line width for display math, required by KaTeX's limit layout. */
    readonly displayWidth?: number;
    readonly left: number;
    readonly bottom: number;
}

/** Geometry is stored in PDF points relative to the KaTeX box's lower-left. */
export interface MathLayout {
    readonly width: number;
    readonly height: number;
    readonly baseFontSize: number;
    readonly verticalAlign: number;
    readonly searchableText: string;
    readonly glyphs: readonly MathGlyph[];
    readonly rules: readonly MathRule[];
    /** Source KaTeX DOM for the paginated browser preview. PDF uses glyphs/rules above. */
    readonly preview?: MathPreviewLayout;
}

const POINTS_PER_PIXEL = 0.75;
const OMITTED_CHARACTERS = /[\u200b\u2061-\u2064]/u;
let glyphMetricsContext: CanvasRenderingContext2D | undefined;

/**
 * Reads KaTeX's browser layout so the preview canvas and PDF use the same
 * fraction, script, delimiter, and operator geometry. A zero-sized box means
 * the current environment cannot measure DOM text, so callers can use their
 * ordinary text fallback instead.
 */
export function readMathLayout(element: HTMLElement): MathLayout | null {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const previewScale = ancestorScale(element);

    const parentFontSize = Number.parseFloat(
        getComputedStyle(element.parentElement ?? element).fontSize
    );
    const baseFontSize =
        Number.isFinite(parentFontSize) && parentFontSize > 0
            ? parentFontSize * POINTS_PER_PIXEL
            : 12;
    const rootStyle = getComputedStyle(element);
    const verticalAlign = verticalAlignInPoints(rootStyle.verticalAlign, rootStyle.fontSize);
    const glyphs: MathGlyph[] = [];
    const rules: MathRule[] = [];
    const content = element.querySelector<HTMLElement>(".katex-html") ?? element;
    const rootHeight = (bounds.height / previewScale.y) * POINTS_PER_PIXEL;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;

    const visitText = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent ?? "";
            const parent = node.parentElement;
            if (parent === null) return;
            const style = getComputedStyle(parent);
            const fontSizePx = Number.parseFloat(style.fontSize);
            const fontSize =
                Number.isFinite(fontSizePx) && fontSizePx > 0
                    ? fontSizePx * POINTS_PER_PIXEL
                    : baseFontSize;
            const font = katexFontFile(style.fontFamily, style.fontWeight, style.fontStyle);
            for (let offset = 0; offset < text.length;) {
                const codePoint = text.codePointAt(offset);
                if (codePoint === undefined) break;
                const character = String.fromCodePoint(codePoint);
                const next = offset + character.length;
                if (!OMITTED_CHARACTERS.test(character)) {
                    const range = document.createRange();
                    range.setStart(node, offset);
                    range.setEnd(node, next);
                    const rect = range.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const metrics = measureGlyph(style, character, fontSizePx || 16);
                        const baseline = rect.top + metrics.ascent * previewScale.y;
                        const x =
                            ((rect.left - bounds.left) / previewScale.x) * POINTS_PER_PIXEL +
                            metrics.left * POINTS_PER_PIXEL;
                        const y = ((bounds.bottom - baseline) / previewScale.y) * POINTS_PER_PIXEL;
                        const ascent = metrics.ascent * POINTS_PER_PIXEL;
                        const descent = metrics.descent * POINTS_PER_PIXEL;
                        left = Math.min(left, x - metrics.left * POINTS_PER_PIXEL);
                        right = Math.max(right, x + metrics.right * POINTS_PER_PIXEL);
                        bottom = Math.min(bottom, y - descent);
                        top = Math.max(top, y + ascent);
                        glyphs.push({
                            text: character,
                            font,
                            x,
                            y,
                            size: fontSize
                        });
                    }
                }
                offset = next;
            }
            return;
        }
        for (const child of Array.from(node.childNodes)) visitText(child);
    };
    visitText(content);

    for (const child of Array.from(content.querySelectorAll<HTMLElement>("*"))) {
        const rect = child.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = getComputedStyle(child);
        const addRule = (width: string, side: "top" | "right" | "bottom" | "left"): void => {
            const thickness = Number.parseFloat(width);
            if (!Number.isFinite(thickness) || thickness <= 0) return;
            if (side === "top" || side === "bottom") {
                const y =
                    side === "top"
                        ? (bounds.bottom - rect.top) / previewScale.y - thickness
                        : (bounds.bottom - rect.bottom) / previewScale.y;
                const rule = {
                    x: ((rect.left - bounds.left) / previewScale.x) * POINTS_PER_PIXEL,
                    y: y * POINTS_PER_PIXEL,
                    width: (rect.width / previewScale.x) * POINTS_PER_PIXEL,
                    height: thickness * POINTS_PER_PIXEL
                };
                rules.push(rule);
                left = Math.min(left, rule.x);
                right = Math.max(right, rule.x + rule.width);
                bottom = Math.min(bottom, rule.y);
                top = Math.max(top, rule.y + rule.height);
            } else {
                const x =
                    side === "left"
                        ? (rect.left - bounds.left) / previewScale.x
                        : (rect.right - bounds.left) / previewScale.x - thickness;
                rules.push({
                    x: x * POINTS_PER_PIXEL,
                    y: ((bounds.bottom - rect.bottom) / previewScale.y) * POINTS_PER_PIXEL,
                    width: thickness * POINTS_PER_PIXEL,
                    height: (rect.height / previewScale.y) * POINTS_PER_PIXEL
                });
                left = Math.min(left, x * POINTS_PER_PIXEL);
                right = Math.max(right, (x + thickness) * POINTS_PER_PIXEL);
                bottom = Math.min(
                    bottom,
                    ((bounds.bottom - rect.bottom) / previewScale.y) * POINTS_PER_PIXEL
                );
                top = Math.max(
                    top,
                    ((bounds.bottom - rect.top) / previewScale.y) * POINTS_PER_PIXEL
                );
            }
        };
        addRule(style.borderTopWidth, "top");
        addRule(style.borderRightWidth, "right");
        addRule(style.borderBottomWidth, "bottom");
        addRule(style.borderLeftWidth, "left");
    }

    if (
        (glyphs.length === 0 && rules.length === 0) ||
        ![left, right, bottom, top].every(Number.isFinite)
    ) {
        return null;
    }
    const shiftX = -left;
    const shiftY = -bottom;
    const annotation = element.querySelector("annotation[encoding='application/x-tex']");
    const visibleText = content.textContent ?? "";
    const displayWrapper = element.parentElement?.classList.contains("katex-display")
        ? element.parentElement.cloneNode(true)
        : null;
    const displayWidth = element.parentElement?.classList.contains("katex-display")
        ? element.parentElement.getBoundingClientRect().width / previewScale.x
        : undefined;
    return {
        width: right - left,
        height: top - bottom,
        baseFontSize,
        verticalAlign: verticalAlign + bottom,
        searchableText: annotation?.textContent ?? visibleText,
        glyphs: glyphs.map((glyph) => ({ ...glyph, x: glyph.x + shiftX, y: glyph.y + shiftY })),
        rules: rules.map((rule) => ({ ...rule, x: rule.x + shiftX, y: rule.y + shiftY })),
        preview: {
            // Display-mode CSS controls large-operator limits and fractions.
            // Keep its wrapper when moving the formula onto the canvas page.
            element: (displayWrapper ?? element.cloneNode(true)) as HTMLElement,
            fontSize: Number.parseFloat(
                getComputedStyle(element.parentElement ?? element).fontSize
            ),
            width: right - left,
            height: rootHeight,
            ...(displayWidth === undefined ? {} : { displayWidth }),
            left: 0,
            bottom: shiftY
        }
    };
}

function measureGlyph(
    style: CSSStyleDeclaration,
    character: string,
    fontSizePx: number
): {
    readonly ascent: number;
    readonly descent: number;
    readonly left: number;
    readonly right: number;
} {
    glyphMetricsContext ??= document.createElement("canvas").getContext("2d") ?? undefined;
    if (glyphMetricsContext === undefined) {
        return {
            ascent: fontSizePx * 0.8,
            descent: fontSizePx * 0.2,
            left: 0,
            right: fontSizePx * 0.6
        };
    }
    try {
        glyphMetricsContext.font = `${style.fontStyle} ${style.fontWeight} ${fontSizePx}px ${style.fontFamily}`;
        const metrics = glyphMetricsContext.measureText(character);
        return {
            ascent: metrics.actualBoundingBoxAscent || fontSizePx * 0.8,
            descent: metrics.actualBoundingBoxDescent || fontSizePx * 0.2,
            left: metrics.actualBoundingBoxLeft || 0,
            right: metrics.actualBoundingBoxRight || metrics.width || fontSizePx * 0.6
        };
    } catch {
        return {
            ascent: fontSizePx * 0.8,
            descent: fontSizePx * 0.2,
            left: 0,
            right: fontSizePx * 0.6
        };
    }
}

function ancestorScale(element: HTMLElement): { readonly x: number; readonly y: number } {
    let x = 1;
    let y = 1;
    for (
        let current: HTMLElement | null = element;
        current !== null;
        current = current.parentElement
    ) {
        const transform = getComputedStyle(current).transform;
        if (transform === "none") continue;
        const matrix = new DOMMatrixReadOnly(transform);
        x *= Math.hypot(matrix.a, matrix.b) || 1;
        y *= Math.hypot(matrix.c, matrix.d) || 1;
    }
    return { x, y };
}

function verticalAlignInPoints(value: string, fontSize: string): number {
    if (value === "normal" || value.length === 0) return 0;
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return 0;
    if (value.endsWith("em")) {
        const em = Number.parseFloat(fontSize);
        return amount * (Number.isFinite(em) ? em : 16) * POINTS_PER_PIXEL;
    }
    if (value.endsWith("px")) return amount * POINTS_PER_PIXEL;
    return amount;
}

function katexFontFile(families: string, weight: string, style: string): string {
    const family = /KaTeX_[\w]+/.exec(families)?.[0] ?? "KaTeX_Main";
    const bold = weight === "bold" || Number.parseInt(weight, 10) >= 600;
    const italic = style === "italic" || style === "oblique";
    let variant = "Regular";
    if (family === "KaTeX_Main") {
        variant = bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular";
    } else if (family === "KaTeX_Math") {
        variant = bold ? "BoldItalic" : "Italic";
    } else if (family === "KaTeX_SansSerif") {
        variant = bold ? "Bold" : italic ? "Italic" : "Regular";
    } else if (family === "KaTeX_Caligraphic" || family === "KaTeX_Fraktur") {
        variant = bold ? "Bold" : "Regular";
    }
    return `${family}-${variant}.ttf`;
}
