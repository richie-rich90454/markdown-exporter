import type { PdfImageSource } from "./PdfLayout";

// A wall clock image is never worth the memory: the PDF caps it here.
const MAX_PIXELS = 4096;
const MAX_CACHED_IMAGES = 64;

// Decoded once per source and shared by the preview and the exporter, so an
// image is never read twice for the same document.
const cache = new Map<string, ImageBitmap | null>();

async function read(
    src: string,
    element: HTMLImageElement | undefined
): Promise<ImageBitmap | null> {
    // The browser already decoded this for the preview, so asking it for the
    // bitmap is both the cheapest and the most forgiving path.
    if (element !== undefined && element.complete && element.naturalWidth > 0) {
        try {
            return await createImageBitmap(element);
        } catch {
            // Some images decode for the page but not for the encoder.
        }
    }
    try {
        const response = await fetch(src);
        if (!response.ok) {
            return null;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 2) {
            return null;
        }
        const contentType = response.headers.get("content-type") ?? imageTypeFromDataUrl(src);
        const blob = new Blob([bytes], { type: contentType });
        try {
            return await createImageBitmap(blob);
        } catch {
            // Some browsers decode SVGs for <img> but reject them in
            // createImageBitmap. Keep the same local bytes and use that path.
            return await decodeThroughImage(blob);
        }
    } catch {
        // A broken image, or one the browser refuses to hand out.
        return null;
    }
}

function imageTypeFromDataUrl(src: string): string {
    const match = /^data:(image\/[a-z0-9.+-]+)/i.exec(src);
    return match?.[1] ?? "application/octet-stream";
}

async function decodeThroughImage(blob: Blob): Promise<ImageBitmap | null> {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (context === null || canvas.width === 0 || canvas.height === 0) {
            return null;
        }
        context.drawImage(image, 0, 0);
        return await createImageBitmap(canvas);
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function decodeImage(
    src: string,
    element?: HTMLImageElement
): Promise<ImageBitmap | null> {
    const cached = cache.get(src);
    if (cached !== undefined) {
        cache.delete(src);
        cache.set(src, cached);
        return cached;
    }
    const bitmap = await read(src, element);
    cacheImage(src, bitmap);
    return bitmap;
}

function cacheImage(src: string, bitmap: ImageBitmap | null): void {
    cache.delete(src);
    cache.set(src, bitmap);
    while (cache.size > MAX_CACHED_IMAGES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) return;
        // Active preview/export maps can still be using an evicted bitmap. Drop
        // only the cache reference and let it be collected after those maps.
        cache.delete(oldest);
    }
}

export async function resolveImages(root: Node): Promise<Map<string, ImageBitmap | null>> {
    const resolved = new Map<string, ImageBitmap | null>();
    if (!(root instanceof Element)) {
        return resolved;
    }
    for (const element of Array.from(root.querySelectorAll("img"))) {
        const src = element.currentSrc || element.src;
        if (src.length > 0 && !resolved.has(src)) {
            resolved.set(src, await decodeImage(src, element));
        }
    }
    for (const svg of Array.from(root.querySelectorAll("svg"))) {
        const markup = new XMLSerializer().serializeToString(svg);
        const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        if (!resolved.has(src)) {
            resolved.set(src, await decodeImage(src));
        }
    }
    return resolved;
}

export async function rasterize(bitmap: ImageBitmap): Promise<PdfImageSource | null> {
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let pixels: Uint8ClampedArray | undefined;
    if (context !== null) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        try {
            pixels = context.getImageData(0, 0, width, height).data;
        } catch {
            // A cross-origin image without CORS headers taints the canvas.
            pixels = undefined;
        }
    }
    if (pixels === undefined) {
        return null;
    }

    const samples = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
        const from = index * 4;
        const to = index * 3;
        samples[to] = pixels[from] ?? 0;
        samples[to + 1] = pixels[from + 1] ?? 0;
        samples[to + 2] = pixels[from + 2] ?? 0;
    }
    const compressed = await deflate(samples);
    if (compressed === null) {
        return null;
    }
    return { data: compressed, width, height, jpeg: false, gray: false };
}

async function deflate(samples: Uint8Array): Promise<Uint8Array | null> {
    if (typeof CompressionStream === "undefined") {
        return null;
    }
    try {
        const stream = new Blob([samples as BlobPart])
            .stream()
            .pipeThrough(new CompressionStream("deflate"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        return null;
    }
}
