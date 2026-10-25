export interface RecoveredDraft {
    readonly source: string;
    readonly savedAt: number;
}

export interface DraftRecovery {
    load(): Promise<RecoveredDraft | null>;
    save(source: string): Promise<void>;
}
