import type { DraftRecovery, RecoveredDraft } from "../../port/DraftRecovery";

const DATABASE_NAME = "markdown-exporter-local";
const STORE_NAME = "drafts";
const DRAFT_KEY = "active-document";
const LOCAL_STORAGE_KEY = "markdown-exporter:recovery-draft";

async function loadRecoveryDraft(): Promise<RecoveredDraft | null> {
    try {
        const database = await openDatabase();
        if (database !== null) {
            try {
                const result = await readDraft(database);
                if (result !== null) return result;
            } finally {
                database.close();
            }
        }
    } catch {
        // Browser privacy settings can disable IndexedDB; use localStorage below.
    }
    try {
        const value = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (value === null) return null;
        const parsed = JSON.parse(value) as Partial<RecoveredDraft>;
        return typeof parsed.source === "string"
            ? {
                  source: parsed.source,
                  savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0
              }
            : null;
    } catch {
        return null;
    }
}

async function saveRecoveryDraft(source: string): Promise<void> {
    const draft: RecoveredDraft = { source, savedAt: Date.now() };
    try {
        const database = await openDatabase();
        if (database !== null) {
            try {
                await writeDraft(database, draft);
                return;
            } finally {
                database.close();
            }
        }
    } catch {
        // Keep recovery available in browsers with blocked or unavailable IndexedDB.
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
}

export class BrowserDraftRecovery implements DraftRecovery {
    load(): Promise<RecoveredDraft | null> {
        return loadRecoveryDraft();
    }

    save(source: string): Promise<void> {
        return saveRecoveryDraft(source);
    }
}

function openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error("Could not open local recovery storage."));
        request.onblocked = () => reject(new Error("Local recovery storage is blocked."));
    });
}

function readDraft(database: IDBDatabase): Promise<RecoveredDraft | null> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(DRAFT_KEY);
        request.onsuccess = () => {
            const result = request.result as Partial<RecoveredDraft> | undefined;
            resolve(
                result !== undefined && typeof result.source === "string"
                    ? {
                          source: result.source,
                          savedAt: typeof result.savedAt === "number" ? result.savedAt : 0
                      }
                    : null
            );
        };
        request.onerror = () =>
            reject(request.error ?? new Error("Could not load the recovery draft."));
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("Recovery read was interrupted."));
    });
}

function writeDraft(database: IDBDatabase, draft: RecoveredDraft): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
            reject(transaction.error ?? new Error("Could not save the recovery draft."));
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("Recovery write was interrupted."));
    });
}
