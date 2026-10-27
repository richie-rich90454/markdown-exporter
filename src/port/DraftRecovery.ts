import type { BookProject } from "../domain/BookProject";

export interface RecoveredDraft {
    readonly source: string;
    readonly savedAt: number;
    readonly bookProject?: BookProject;
    readonly activeEntryId?: string;
}

export interface DraftRecovery {
    load(): Promise<RecoveredDraft | null>;
    save(source: string, bookProject?: BookProject, activeEntryId?: string): Promise<void>;
}
