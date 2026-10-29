import type { EditorHistoryPatch } from "./EditorHistory";

/** Finds case-insensitive literal replacements in ascending source order. */
export function findReplacementPatches(
    source: string,
    query: string,
    replacement: string
): EditorHistoryPatch[] {
    if (query.length === 0) return [];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    const patches: EditorHistoryPatch[] = [];
    for (const match of source.matchAll(pattern)) {
        const removed = match[0];
        const from = match.index ?? 0;
        if (removed === replacement) continue;
        patches.push({ from, removed, inserted: replacement });
    }
    return patches;
}

/** Applies replacement patches and their inverse while preserving source-relative offsets. */
export function applyReplacementPatches(
    source: string,
    patches: readonly EditorHistoryPatch[],
    redo: boolean
): string | undefined {
    let result = source;
    let ordered: readonly EditorHistoryPatch[];
    if (redo) {
        // Redo offsets refer to the original source, so apply from right to left.
        ordered = [...patches].reverse();
    } else {
        // Undo offsets refer to the changed source. Translate them in one forward pass,
        // then apply right to left so changing lengths cannot move pending ranges.
        let delta = 0;
        ordered = patches.map((patch) => {
            const adjusted = { ...patch, from: patch.from + delta };
            delta += patch.inserted.length - patch.removed.length;
            return adjusted;
        }).reverse();
    }
    for (const patch of ordered) {
        const expected = redo ? patch.removed : patch.inserted;
        const value = redo ? patch.inserted : patch.removed;
        if (
            !Number.isSafeInteger(patch.from) ||
            patch.from < 0 ||
            patch.from + expected.length > result.length ||
            result.slice(patch.from, patch.from + expected.length) !== expected
        ) return undefined;
        result = result.slice(0, patch.from) + value + result.slice(patch.from + expected.length);
    }
    return result;
}
