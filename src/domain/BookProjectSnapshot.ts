import type { BookProject, BookFileData } from "./BookProject";

/** Creates a detached project snapshot suitable for recovery and save-conflict checks. */
export function cloneBookProject(project: BookProject): BookProject {
    const files: Record<string, BookFileData> = {};
    for (const [path, data] of Object.entries(project.files)) {
        Object.defineProperty(files, path, {
            value: typeof data === "string" ? data : new Uint8Array(data),
            enumerable: true,
            configurable: true,
            writable: true
        });
    }
    return {
        manifest: {
            ...project.manifest,
            metadata: {
                ...project.manifest.metadata,
                authors: [...project.manifest.metadata.authors]
            },
            entries: project.manifest.entries.map((entry) => ({ ...entry }))
        },
        files
    };
}

/** Compares the complete manifest and every text or binary file in two snapshots. */
export function sameBookProject(left: BookProject, right: BookProject): boolean {
    if (JSON.stringify(left.manifest) !== JSON.stringify(right.manifest)) return false;
    const leftPaths = Object.keys(left.files).sort();
    const rightPaths = Object.keys(right.files).sort();
    if (leftPaths.length !== rightPaths.length) return false;
    for (let index = 0; index < leftPaths.length; index += 1) {
        const leftPath = leftPaths[index];
        const rightPath = rightPaths[index];
        if (leftPath !== rightPath) return false;
        const leftData = left.files[leftPath ?? ""];
        const rightData = right.files[rightPath ?? ""];
        if (typeof leftData === "string" || typeof rightData === "string") {
            if (leftData !== rightData) return false;
            continue;
        }
        if (
            leftData === undefined ||
            rightData === undefined ||
            leftData.length !== rightData.length
        )
            return false;
        for (let byte = 0; byte < leftData.length; byte += 1) {
            if (leftData[byte] !== rightData[byte]) return false;
        }
    }
    return true;
}
