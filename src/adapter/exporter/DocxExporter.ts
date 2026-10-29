import { ExportFormat } from "../../domain/ExportFormat";
import type { BookProject } from "../../domain/BookProject";
import type { ExportRequest } from "../../domain/ExportRequest";
import type { ExportResult } from "../../domain/ExportResult";
import { ExportResults } from "../../domain/ExportResult";
import type { DocumentExporter } from "../../port/DocumentExporter";
import type { FileSaver } from "../../port/FileSaver";
import { pageDimensions } from "../../domain/PageSetup";
import {
    createBookContentsPage,
    createBookTitlePage,
    publicationSlug,
    publicationTitle,
    renderBookSections,
    resolveBookImageReferences,
    serializeContent
} from "./BookExportContent";
import { addCitationReferences } from "./CitationPublisher";

export class DocxExporter implements DocumentExporter {
    readonly supportedFormat = ExportFormat.DOCX;

    constructor(private readonly fileSaver: FileSaver) {}

    async export(request: ExportRequest): Promise<ExportResult> {
        if (request.format !== this.supportedFormat) {
            throw new Error(`DocxExporter cannot export ${request.format}`);
        }
        const project = request.bookProject;
        const sections = await renderBookSections(request);
        await addCitationReferences(sections, project);

        const [
            {
                Document,
                Packer,
                Paragraph,
                PageBreak,
                AlignmentType,
                Header,
                Footer,
                PageNumberElement,
                TextRun
            },
            { htmlToContent }
        ] = await Promise.all([import("docx"), import("docx/html")]);
        const warnings: string[] = [];
        const documentChildren = [];
        const isBook = request.isBookProject;
        const metadata = project?.manifest.metadata;
        const title = publicationTitle(project, request.title, isBook);
        const dimensions = pageDimensions(request.pageSetup);
        const fontFamily =
            request.pageSetup.fontFamily === "sans"
                ? "Noto Sans"
                : request.pageSetup.fontFamily === "mono"
                  ? "Consolas"
                  : "Georgia";
        const codeFontFamily = "Consolas";
        const lineTwips = Math.round(
            request.pageSetup.fontSizePt * 20 * request.pageSetup.lineHeight
        );
        const maxImageWidth = Math.max(
            120,
            ((dimensions.widthMm - request.pageSetup.marginMm * 2) * 96) / 25.4
        );
        const htmlStylesheet = [
            `p,li,td,th,blockquote{font-family:"${fontFamily}";font-size:${request.pageSetup.fontSizePt}pt;line-height:${request.pageSetup.lineHeight}}`,
            `h1,h2,h3,h4,h5,h6{font-family:"${fontFamily}";line-height:1.2}`,
            `pre{font-family:"${codeFontFamily}";font-size:${request.pageSetup.fontSizePt * 0.9}pt;background:#f6f7f9}`,
            `code{font-family:"${codeFontFamily}";font-size:.9em}`
        ].join("\n");
        const diagramImages = new Map<
            string,
            { readonly data: string; readonly fallback?: Uint8Array }
        >();
        const htmlOptions = {
            notes: "footnotes" as const,
            styleMap: { table: "TableGrid", pre: "SourceCode", code: "InlineCode" },
            stylesheet: htmlStylesheet,
            maxImageWidth,
            images: (source: string) => diagramImages.get(source),
            onWarning: (warning: { readonly message: string }) => warnings.push(warning.message)
        };
        if (isBook) {
            documentChildren.push(
                ...htmlToContent(serializeContent(createBookTitlePage(project, title)), htmlOptions)
            );
            documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
            documentChildren.push(
                ...htmlToContent(serializeContent(createBookContentsPage(sections)), htmlOptions)
            );
            documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
        }
        for (const [index, section] of sections.entries()) {
            const content = section.content;
            resolveBookImageReferences(content, project, section.entry?.path);
            await embedProjectImages(content, project, section.entry?.path ?? "");
            if (index > 0 && section.entry?.role !== "front-matter")
                documentChildren.push(new Paragraph({ children: [new PageBreak()] }));
            await prepareDiagramImages(content, diagramImages, warnings);
            documentChildren.push(...htmlToContent(serializeContent(content), htmlOptions));
        }

        const toTwips = (millimeters: number): number => Math.round((millimeters * 1440) / 25.4);
        const marginTwips = toTwips(request.pageSetup.marginMm);
        const header = isBook
            ? new Header({
                  children: [
                      new Paragraph({
                          alignment: AlignmentType.CENTER,
                          children: [new TextRun(title)]
                      })
                  ]
              })
            : undefined;
        const footer = new Footer({
            children: [
                new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                        new TextRun("Page "),
                        new TextRun({ children: [new PageNumberElement()] })
                    ]
                })
            ]
        });
        const document = new Document({
            creator: metadata?.authors.join(", ") || "Markdown Exporter",
            title,
            ...(metadata?.description === undefined
                ? {}
                : { subject: metadata.description, description: metadata.description }),
            ...(metadata?.isbn === undefined ? {} : { keywords: `ISBN ${metadata.isbn}` }),
            ...(warnings.length === 0
                ? {}
                : {
                      customProperties: [
                          {
                              name: "Markdown export warnings",
                              value: warnings.join("\n").slice(0, 2000)
                          }
                      ]
                  }),
            styles: {
                default: {
                    document: {
                        run: {
                            font: fontFamily,
                            size: Math.round(request.pageSetup.fontSizePt * 2),
                            language: { value: metadata?.language || "en" }
                        },
                        paragraph: { spacing: { line: lineTwips, lineRule: "atLeast" } }
                    }
                },
                paragraphStyles: [
                    {
                        id: "SourceCode",
                        name: "Source Code",
                        basedOn: "Normal",
                        run: {
                            font: codeFontFamily,
                            size: Math.round(request.pageSetup.fontSizePt * 1.8),
                            color: "303846"
                        },
                        paragraph: {
                            shading: { fill: "F6F7F9" },
                            spacing: { before: 80, after: 80, line: lineTwips, lineRule: "atLeast" }
                        }
                    }
                ],
                characterStyles: [
                    {
                        id: "InlineCode",
                        name: "Inline Code",
                        run: {
                            font: codeFontFamily,
                            size: Math.round(request.pageSetup.fontSizePt * 1.8),
                            color: "303846"
                        }
                    }
                ]
            },
            theme: { fonts: { body: fontFamily, headings: fontFamily } },
            sections: [
                {
                    ...(header === undefined
                        ? {}
                        : {
                              headers: { default: header, first: new Header({ children: [] }) }
                          }),
                    footers: {
                        default: footer,
                        ...(isBook ? { first: new Footer({ children: [] }) } : {})
                    },
                    properties: {
                        titlePage: isBook,
                        page: {
                            size: {
                                width: toTwips(dimensions.widthMm),
                                height: toTwips(dimensions.heightMm)
                            },
                            margin: {
                                top: marginTwips,
                                right: marginTwips,
                                bottom: marginTwips,
                                left: marginTwips,
                                header: Math.min(720, Math.round(marginTwips / 2)),
                                footer: Math.min(720, Math.round(marginTwips / 2))
                            }
                        }
                    },
                    children: documentChildren
                }
            ]
        });
        const blob = await Packer.toBlob(document);
        this.fileSaver.saveBlob(blob, `${publicationSlug(title)}.docx`);
        return ExportResults.success(this.supportedFormat);
    }
}

async function prepareDiagramImages(
    content: Node,
    images: Map<string, { readonly data: string; readonly fallback?: Uint8Array }>,
    warnings: string[]
): Promise<void> {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    for (const [index, svg] of Array.from(
        content.querySelectorAll<SVGSVGElement>("svg")
    ).entries()) {
        const source = new XMLSerializer().serializeToString(svg);
        const dataUrl = `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(source))}`;
        const fallback = await rasterizeSvg(source);
        images.set(dataUrl, fallback === null ? { data: dataUrl } : { data: dataUrl, fallback });

        const image = document.createElement("img");
        image.src = dataUrl;
        const altText = diagramAltText(svg);
        image.alt = altText || "Diagram; see surrounding text for an explanation.";
        image.className = "markdown-diagram";
        if (altText.length === 0)
            warnings.push(
                `Diagram ${index + 1} has no accessible title or description; its surrounding text must explain it.`
            );
        if (fallback === null)
            warnings.push(
                `Diagram ${index + 1} has no PNG fallback; older Word versions may not display its SVG.`
            );
        svg.replaceWith(image);
    }
}

function diagramAltText(svg: SVGSVGElement): string {
    const labelled = svg.getAttribute("aria-label")?.trim();
    if (labelled) return labelled;
    const title = svg.querySelector("title")?.textContent?.trim();
    if (title) return title;
    const description = svg.querySelector("desc")?.textContent?.trim();
    return description ?? "";
}

async function rasterizeSvg(source: string): Promise<Uint8Array | null> {
    if (typeof URL.createObjectURL !== "function") return null;
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const viewBox = imageViewBox(source);
        const sourceWidth = viewBox?.width || image.naturalWidth || 1200;
        const sourceHeight = viewBox?.height || image.naturalHeight || 800;
        const scale = Math.min(1.5, 2400 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext("2d");
        if (context === null) return null;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png")
        );
        return blob === null ? null : new Uint8Array(await blob.arrayBuffer());
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function imageViewBox(source: string): { readonly width: number; readonly height: number } | null {
    const viewBox = /\bviewBox\s*=\s*(["'])([^"']+)\1/i.exec(source)?.[2];
    const values = viewBox
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    if (values?.length !== 4 || !Number.isFinite(values[2]) || !Number.isFinite(values[3]))
        return null;
    return { width: Math.max(1, values[2] ?? 1), height: Math.max(1, values[3] ?? 1) };
}

async function embedProjectImages(
    content: Node,
    project: BookProject | undefined,
    chapterPath: string
): Promise<void> {
    if (!(content instanceof Element || content instanceof DocumentFragment)) return;
    const images = Array.from(content.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(
        images.map(async (image) => {
            const source = image.getAttribute("src") ?? "";
            if (source.startsWith("data:image/")) return;
            if (project !== undefined && !/^(?:blob:|https?:|\/\/|\/)/i.test(source)) {
                const local = findProjectFile(project, chapterPath, source);
                if (local instanceof Uint8Array) {
                    const mime = mimeForPath(source);
                    image.setAttribute("src", `data:${mime};base64,${encodeBase64(local)}`);
                    return;
                }
            }
            let url: URL;
            try {
                url = new URL(source, document.baseURI);
            } catch {
                markImageMissing(image);
                return;
            }
            const localUrl =
                url.protocol === "blob:" ||
                ((url.protocol === "http:" || url.protocol === "https:") &&
                    url.origin === window.location.origin);
            if (!localUrl) {
                markImageMissing(image);
                return;
            }
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error("Image could not be read.");
                const blob = await response.blob();
                const mimeType = (blob.type || response.headers.get("content-type") || "")
                    .split(";")[0]
                    ?.toLowerCase();
                if (mimeType === undefined || !mimeType.startsWith("image/"))
                    throw new Error("The local resource is not an image.");
                image.setAttribute(
                    "src",
                    `data:${mimeType};base64,${encodeBase64(new Uint8Array(await blob.arrayBuffer()))}`
                );
            } catch {
                markImageMissing(image);
            }
        })
    );
}

function findProjectFile(
    project: BookProject,
    chapterPath: string,
    source: string
): string | Uint8Array | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(source.split(/[?#]/, 1)[0] ?? source);
    } catch {
        return undefined;
    }
    const parts = chapterPath.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
            if (parts.length === 0) return undefined;
            parts.pop();
        } else parts.push(part);
    }
    return project.files[parts.join("/")];
}

function mimeForPath(path: string): string {
    switch (path.toLowerCase().split(".").at(-1)) {
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "webp":
            return "image/webp";
        case "svg":
            return "image/svg+xml";
        default:
            return "image/png";
    }
}

function markImageMissing(image: HTMLImageElement): void {
    const fallback = document.createElement("span");
    fallback.textContent =
        image.alt.trim().length > 0 ? `[Image: ${image.alt.trim()}]` : "[Image unavailable]";
    fallback.setAttribute("role", "img");
    fallback.setAttribute(
        "aria-label",
        image.alt.trim().length > 0 ? image.alt.trim() : "Image unavailable"
    );
    image.replaceWith(fallback);
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}
