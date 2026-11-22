export const ExportFormat = {
    PDF: "pdf",
    HTML: "html",
    EPUB: "epub",
    DOCX: "docx"
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const EXPORT_FORMAT_LABELS: Readonly<Record<ExportFormat, string>> = {
    [ExportFormat.PDF]: "PDF",
    [ExportFormat.HTML]: "HTML",
    [ExportFormat.EPUB]: "EPUB",
    [ExportFormat.DOCX]: "Word document"
};

export const EXPORT_FORMAT_DESCRIPTIONS: Readonly<Record<ExportFormat, string>> = {
    pdf: "Print or share with a fixed page layout",
    html: "A standalone web page you can open offline",
    epub: "Read on an e-reader or in a books app",
    docx: "Continue editing in Word or Google Docs"
};
