import { ExportFormat } from "../../domain/ExportFormat";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import type { LaidOut, PdfImageSource } from "../../domain/pdf/PdfLayout";
import { parseBlocks } from "../../domain/pdf/PdfLayout";
import { font, textWidth } from "../../domain/pdf/PdfMetrics";
import { paginate } from "../../domain/pdf/PdfPaginate";
import { resolveImages, rasterize } from "../../domain/pdf/ImageDecode";
import { writePdf } from "../../domain/pdf/PdfWriter";
import {
    marginPt,
    pageDimensions,
    pageHeightPt,
    pageWidthPt,
    PX_PER_MM
} from "../../domain/PageSetup";
import {
    createBookContentsPage,
    createBookTitlePage,
    publicationSlug,
    publicationTitle,
    renderBookSections,
    resolveBookImageReferences
} from "./BookExportContent";
import { addCitationReferences } from "./CitationPublisher";

export class PdfExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.PDF;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`PdfExporter cannot export ${request.format}`);
        }
        const title = publicationTitle(request.bookProject, request.title, request.isBookProject);
        const content = await pdfContent(request);
        const decoded = await resolveImages(content);
        const embeds = new Map<string, boolean>();
        const drawn = new Map<string, PdfImageSource | null>();
        for (const [src, bitmap] of decoded) {
            const image = bitmap === null ? null : await rasterize(bitmap);
            embeds.set(src, image !== null);
            drawn.set(src, image);
        }
        // KaTeX's PDF layout is read from rendered browser geometry. Book export
        // creates a detached tree, where every MathLayout would have zero-sized
        // ranges and degrade to unpositioned text. Mount it invisibly at the
        // preview's width while measuring, then discard the temporary tree.
        const measureHost = mountForMeasurement(content, request.pageSetup);
        let layout: LaidOut;
        try {
            // jsdom and older browser engines may not expose FontFaceSet.
            if (document.fonts !== undefined) await document.fonts.ready;
            layout = paginate(parseBlocks(content), request.pageSetup, embeds);
        } finally {
            measureHost.remove();
        }
        if (request.isBookProject) {
            layout = addRunningBookHeaders(layout, title, request.pageSetup);
        }
        const katexFonts =
            layout.mathFonts.length > 0
                ? await (await import("./KatexPdfFonts")).loadKatexPdfFonts(layout.mathFonts)
                : undefined;
        const metadata = request.bookProject?.manifest.metadata;
        const bytes: Uint8Array = writePdf(
            layout,
            layout.images.map((image) => drawn.get(image.src) ?? null),
            title,
            request.pageSetup,
            katexFonts,
            {
                language: metadata?.language || "en",
                ...(metadata?.authors.length ? { author: metadata.authors.join("; ") } : {}),
                ...(metadata?.description === undefined ? {} : { subject: metadata.description }),
                keywords: [metadata?.publisher, metadata?.isbn]
                    .filter(
                        (value): value is string => value !== undefined && value.trim().length > 0
                    )
                    .join("; ")
            }
        );
        this.fileSaver.saveBlob(
            new Blob([bytes as BlobPart], { type: "application/pdf" }),
            `${publicationSlug(title)}.pdf`
        );
        return ExportResults.success(this.supportedFormat);
    }
}

function addRunningBookHeaders(
    layout: LaidOut,
    title: string,
    setup: ExportRequest["pageSetup"]
): LaidOut {
    if (layout.pages.length < 2 || title.length === 0) return layout;
    const headerFont = font(false, false, false, setup.fontFamily);
    const headerSize = 8;
    const maxWidth = pageWidthPt(setup) - 2 * marginPt(setup);
    let headerText = title;
    while (headerText.length > 3 && textWidth(headerText, headerFont, headerSize) > maxWidth) {
        headerText = `${headerText.slice(0, -4)}...`;
    }
    const x = (pageWidthPt(setup) - textWidth(headerText, headerFont, headerSize)) / 2;
    const header = {
        kind: "text" as const,
        x,
        y: pageHeightPt(setup) - marginPt(setup) / 2,
        text: headerText,
        font: headerFont,
        size: headerSize,
        gray: 0.42
    };
    return {
        ...layout,
        pages: layout.pages.map((operations, index) =>
            index === 0 ? operations : [...operations, header]
        ),
        fonts: layout.fonts.some(
            (existing) =>
                existing.family === headerFont.family &&
                existing.bold === headerFont.bold &&
                existing.italic === headerFont.italic &&
                existing.mono === headerFont.mono
        )
            ? layout.fonts
            : [...layout.fonts, headerFont]
    };
}

function mountForMeasurement(content: HTMLElement, setup: ExportRequest["pageSetup"]): HTMLElement {
    // Measure against the selected paper size itself. Reading a preview node's
    // clientWidth makes export depend on responsive layout and zoom state, even
    // though PDF coordinates always describe the unzoomed page.
    const pageWidth = Math.round(pageDimensions(setup).widthMm * PX_PER_MM);
    content.classList.add("preview__flow", "pdf-measurement-flow");
    content.style.position = "fixed";
    content.style.top = "0";
    content.style.left = "-100000px";
    content.style.visibility = "hidden";
    content.style.pointerEvents = "none";
    content.style.width = `${pageWidth}px`;
    content.style.height = "auto";
    document.body.append(content);
    return content;
}

async function pdfContent(request: ExportRequest): Promise<HTMLElement> {
    const sections = await renderBookSections(request);
    await addCitationReferences(sections, request.bookProject);
    const isBook = request.isBookProject;
    const root = document.createElement("div");
    if (isBook) {
        root.append(createBookTitlePage(request.bookProject, request.title));
        const titleBreak = document.createElement("div");
        titleBreak.className = "book-page-break";
        root.append(titleBreak);
        root.append(createBookContentsPage(sections));
        const contentsBreak = document.createElement("div");
        contentsBreak.className = "book-page-break";
        root.append(contentsBreak);
    }
    for (const [index, section] of sections.entries()) {
        if (isBook && index > 0 && section.entry?.role !== "front-matter") {
            const pageBreak = document.createElement("div");
            pageBreak.className = "book-page-break";
            root.append(pageBreak);
        }
        resolveBookImageReferences(section.content, request.bookProject, section.entry?.path);
        if (section.content instanceof DocumentFragment) root.append(section.content);
        else root.append(section.content.cloneNode(true));
    }
    return root;
}
