import { describe, expect, it, vi } from "vitest";

import type { DesktopBridge } from "../../src/adapter/desktop/DesktopBridge";
import { decodeBytes, encodeBlob } from "../../src/adapter/desktop/DesktopBridge";
import { DesktopDocuments } from "../../src/adapter/desktop/DesktopDocuments";
import { DesktopDraftRecovery } from "../../src/adapter/desktop/DesktopDraftRecovery";
import { DesktopFileSaver } from "../../src/adapter/desktop/DesktopFileSaver";
import { createSingleChapterBook } from "../../src/domain/BookProject";

function bridge() {
    return {
        ChooseFile: vi
            .fn<DesktopBridge["ChooseFile"]>()
            .mockResolvedValue({ id: "file-1", name: "notes.md", kind: "file" }),
        ChooseSave: vi
            .fn<DesktopBridge["ChooseSave"]>()
            .mockResolvedValue({ id: "file-2", name: "output.pdf", kind: "file" }),
        ChooseFolder: vi
            .fn<DesktopBridge["ChooseFolder"]>()
            .mockResolvedValue({ id: "folder-1", name: "Book", kind: "directory" }),
        Child: vi.fn<DesktopBridge["Child"]>(),
        List: vi.fn<DesktopBridge["List"]>().mockResolvedValue([]),
        ReadFile: vi
            .fn<DesktopBridge["ReadFile"]>()
            .mockResolvedValue({ data: btoa("# Original"), modified: 123 }),
        WriteFile: vi.fn<DesktopBridge["WriteFile"]>().mockResolvedValue(undefined),
        RemoveFile: vi.fn<DesktopBridge["RemoveFile"]>().mockResolvedValue(undefined),
        LoadRecovery: vi.fn<DesktopBridge["LoadRecovery"]>().mockResolvedValue(""),
        SaveRecovery: vi.fn<DesktopBridge["SaveRecovery"]>().mockResolvedValue(undefined),
        Ready: vi.fn<DesktopBridge["Ready"]>().mockResolvedValue(undefined),
        ConfirmClose: vi.fn<DesktopBridge["ConfirmClose"]>().mockResolvedValue(undefined),
        ShowPrivacy: vi.fn<DesktopBridge["ShowPrivacy"]>().mockResolvedValue(undefined)
    } satisfies DesktopBridge;
}

describe("Desktop adapters", () => {
    it("preserves every binary byte across the bridge", async () => {
        const data = new Uint8Array([0, 1, 127, 128, 254, 255]);
        expect(decodeBytes(await encodeBlob(new Blob([data])))).toEqual(data);
    });

    it("treats native picker cancellation as cancellation, without a browser fallback", async () => {
        const native = bridge();
        native.ChooseFile.mockResolvedValue(null);
        native.ChooseSave.mockResolvedValue(null);
        native.ChooseFolder.mockResolvedValue(null);
        const documents = new DesktopDocuments(native);
        await expect(documents.pickOpenFile()).rejects.toMatchObject({ name: "AbortError" });
        await expect(documents.pickSaveFile("draft.md")).rejects.toMatchObject({
            name: "AbortError"
        });
        await expect(documents.pickDirectory()).rejects.toMatchObject({ name: "AbortError" });
        expect(native.WriteFile).not.toHaveBeenCalled();
    });

    it("buffers a file write until close and discards it on abort", async () => {
        const native = bridge();
        const handle = await new DesktopDocuments(native).pickOpenFile();
        const stream = await handle.createWritable();
        await stream.write("# Changed");
        expect(native.WriteFile).not.toHaveBeenCalled();
        await stream.abort?.();
        await stream.close();
        expect(native.WriteFile).not.toHaveBeenCalled();
        await new DesktopDocuments(native).writeFile(handle, "# Committed");
        expect(native.WriteFile).toHaveBeenCalledWith("file-1", btoa("# Committed"));
    });

    it("preserves NotFoundError so book-folder detection still works", async () => {
        const native = bridge();
        native.Child.mockRejectedValue("NotFoundError: absent");
        const folder = await new DesktopDocuments(native).pickDirectory();
        await expect(folder.getFileHandle("book.json")).rejects.toMatchObject({
            name: "NotFoundError"
        });
    });

    it("waits for the native save and propagates failure and cancellation", async () => {
        const native = bridge();
        native.WriteFile.mockRejectedValue(new Error("Disk full"));
        const saver = new DesktopFileSaver(native);
        await expect(saver.saveBlob(new Blob(["document"]), "document.pdf")).rejects.toThrow(
            "Disk full"
        );
        native.ChooseSave.mockResolvedValue(null);
        await expect(saver.saveBlob(new Blob(["document"]), "document.pdf")).rejects.toMatchObject({
            name: "AbortError"
        });
        expect(native.WriteFile).toHaveBeenCalledTimes(1);
    });

    it("recovers full book metadata and binary resources without changing bytes", async () => {
        const native = bridge();
        const project = createSingleChapterBook("# Draft", "Local book");
        const book = {
            ...project,
            files: { ...project.files, "assets/cover.png": new Uint8Array([0, 128, 255]) }
        };
        const recovery = new DesktopDraftRecovery(native);
        await recovery.save("# Draft", book, project.manifest.entries[0]!.id);
        native.LoadRecovery.mockResolvedValue(native.SaveRecovery.mock.calls[0]![0]);
        const recovered = await new DesktopDraftRecovery(native).load();
        expect(recovered?.bookProject).toEqual(book);
        expect(recovered?.activeEntryId).toBe(project.manifest.entries[0]!.id);
    });

    it("keeps recovery writes ordered and allows later saves after a failure", async () => {
        const native = bridge();
        native.SaveRecovery.mockRejectedValueOnce(new Error("Disk full"));
        const recovery = new DesktopDraftRecovery(native);
        await expect(recovery.save("First")).rejects.toThrow("Disk full");
        await recovery.save("Second");
        expect(
            native.SaveRecovery.mock.calls.map(
                ([snapshot]) => (JSON.parse(snapshot) as { source: string }).source
            )
        ).toEqual(["First", "Second"]);
    });

    it("preserves text files named __proto__ in durable recovery", async () => {
        const native = bridge();
        const project = createSingleChapterBook("# Draft", "Local book");
        Object.defineProperty(project.files, "__proto__", {
            value: "A valid project resource",
            enumerable: true
        });
        await new DesktopDraftRecovery(native).save("# Draft", project);
        native.LoadRecovery.mockResolvedValue(native.SaveRecovery.mock.calls[0]![0]);
        const restored = await new DesktopDraftRecovery(native).load();
        expect(Object.hasOwn(restored!.bookProject!.files, "__proto__")).toBe(true);
        expect(restored!.bookProject!.files["__proto__"]).toBe("A valid project resource");
    });
});
