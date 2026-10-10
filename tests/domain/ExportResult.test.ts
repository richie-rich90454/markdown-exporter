import { describe, expect, it } from "vitest";

import { ExportFormat, EXPORT_FORMAT_LABELS, isExportFormat } from "../../src/domain/ExportFormat";
import { ExportResults, isExportSuccess } from "../../src/domain/ExportResult";

describe("ExportFormat", () => {
    it("ships PDF and HTML", () => {
        expect(Object.values(ExportFormat)).toEqual(["pdf", "html"]);
    });

    it("labels every format", () => {
        expect(EXPORT_FORMAT_LABELS[ExportFormat.PDF]).toBe("PDF");
        expect(EXPORT_FORMAT_LABELS[ExportFormat.HTML]).toBe("HTML");
    });

    it("guards unknown strings", () => {
        expect(isExportFormat("pdf")).toBe(true);
        expect(isExportFormat("docx")).toBe(false);
    });
});

describe("ExportResult", () => {
    it("is a sealed discriminated union", () => {
        expect(ExportResults.success(ExportFormat.HTML)).toEqual({
            kind: "success",
            format: "html"
        });
        expect(ExportResults.cancelled(ExportFormat.PDF)).toEqual({
            kind: "cancelled",
            format: "pdf"
        });
        expect(ExportResults.failure(ExportFormat.PDF, "no paper")).toEqual({
            kind: "failure",
            format: "pdf",
            message: "no paper"
        });
    });

    it("narrows success", () => {
        const result = ExportResults.success(ExportFormat.PDF);
        expect(isExportSuccess(result)).toBe(true);
        expect(isExportSuccess(ExportResults.failure(ExportFormat.PDF, "x"))).toBe(false);
    });
});
