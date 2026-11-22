import { validateBookProject, type BookProject } from "../../domain/BookProject";
import type { DraftRecovery, RecoveredDraft } from "../../port/DraftRecovery";
import { decodeBytes, encodeBlob, type DesktopBridge } from "./DesktopBridge";

export class DesktopDraftRecovery implements DraftRecovery {
    private writes: Promise<void> = Promise.resolve();
    private savedAt = 0;
    constructor(private readonly bridge: DesktopBridge) {}

    async load(): Promise<RecoveredDraft | null> {
        const json = await this.bridge.LoadRecovery();
        if (json === "") return null;
        const snapshot = JSON.parse(json) as Partial<RecoveredDraft> & {
            binaryFiles?: Record<string, string>;
        };
        if (typeof snapshot.source !== "string")
            throw new Error("The saved desktop draft is damaged.");
        let bookProject: BookProject | undefined;
        if (snapshot.bookProject !== undefined) {
            const files = { ...snapshot.bookProject.files };
            for (const [path, data] of Object.entries(snapshot.binaryFiles ?? {})) {
                Object.defineProperty(files, path, {
                    value: decodeBytes(data),
                    enumerable: true,
                    configurable: true
                });
            }
            bookProject = validateBookProject({ ...snapshot.bookProject, files });
        }
        this.savedAt =
            typeof snapshot.savedAt === "number" && Number.isFinite(snapshot.savedAt)
                ? snapshot.savedAt
                : 0;
        return {
            source: snapshot.source,
            savedAt: this.savedAt,
            ...(bookProject === undefined ? {} : { bookProject }),
            ...(typeof snapshot.activeEntryId === "string" &&
            bookProject?.manifest.entries.some((entry) => entry.id === snapshot.activeEntryId)
                ? { activeEntryId: snapshot.activeEntryId }
                : {})
        };
    }

    save(source: string, bookProject?: BookProject, activeEntryId?: string): Promise<void> {
        // Capture an immutable snapshot at the call boundary, before queuing IO.
        const savedAt = (this.savedAt = Math.max(Date.now(), this.savedAt + 1));
        const captured =
            bookProject === undefined
                ? undefined
                : {
                      ...bookProject,
                      files: Object.fromEntries(
                          Object.entries(bookProject.files).map(([path, data]) => [
                              path,
                              typeof data === "string" ? data : data.slice()
                          ])
                      )
                  };
        const pending = this.writes.then(async () => {
            const binaryFiles: Record<string, string> = {};
            const files: Record<string, string> = {};
            for (const [path, data] of Object.entries(captured?.files ?? {})) {
                if (typeof data === "string")
                    Object.defineProperty(files, path, { value: data, enumerable: true });
                else
                    Object.defineProperty(binaryFiles, path, {
                        value: await encodeBlob(new Blob([data])),
                        enumerable: true
                    });
            }
            await this.bridge.SaveRecovery(
                JSON.stringify({
                    source,
                    savedAt,
                    ...(captured === undefined
                        ? {}
                        : { bookProject: { ...captured, files }, binaryFiles, activeEntryId })
                })
            );
        });
        this.writes = pending.catch(() => undefined);
        return pending;
    }
}
