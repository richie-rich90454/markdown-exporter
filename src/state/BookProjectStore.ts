import { createSignal, type Accessor, type Setter } from "solid-js";

import {
    createSingleChapterBook,
    assertSafeBookPath,
    updateBookChapter,
    type BookEntry,
    type BookProject
} from "../domain/BookProject";

export interface BookSearchMatch {
    readonly entryId: string;
    readonly path: string;
    readonly title: string;
    readonly line: number;
    readonly excerpt: string;
}

export class BookProjectStore {
    readonly current: Accessor<BookProject>;
    readonly activeEntryId: Accessor<string>;

    private readonly setProject: Setter<BookProject>;
    private readonly setActiveEntryId: Setter<string>;

    constructor() {
        const initial = createSingleChapterBook("");
        const [project, setProject] = createSignal(initial);
        const [activeEntryId, setActiveEntryId] = createSignal(
            initial.manifest.entries[0]?.id ?? "chapter-1"
        );
        this.current = project;
        this.activeEntryId = activeEntryId;
        this.setProject = setProject;
        this.setActiveEntryId = setActiveEntryId;
    }

    open(project: BookProject, activeEntryId?: string): void {
        const first = project.manifest.entries[0];
        const active = activeEntryId ?? first?.id ?? "";
        if (!project.manifest.entries.some((entry) => entry.id === active)) {
            throw new Error(`Unknown book entry: ${active}.`);
        }
        this.setProject(project);
        this.setActiveEntryId(active);
    }

    updateActive(source: string): void {
        const project = this.current();
        this.setProject(updateBookChapter(project, this.activeEntryId(), source));
    }

    updateMetadata(metadata: Partial<BookProject["manifest"]["metadata"]>): void {
        const project = this.current();
        const next = {
            ...project,
            manifest: {
                ...project.manifest,
                metadata: { ...project.manifest.metadata, ...metadata }
            }
        };
        this.setProject(next);
    }

    putFile(path: string, data: BookProject["files"][string]): void {
        assertSafeBookPath(path);
        const project = this.current();
        this.setProject({ ...project, files: { ...project.files, [path]: data } });
    }

    setBibliographyPath(path: string): void {
        assertSafeBookPath(path);
        const project = this.current();
        if (typeof project.files[path] !== "string") throw new Error("The bibliography file is missing.");
        this.setProject({ ...project, manifest: { ...project.manifest, bibliographyPath: path } });
    }

    setCitationStylePath(path: string): void {
        assertSafeBookPath(path);
        const project = this.current();
        if (typeof project.files[path] !== "string") throw new Error("The citation style file is missing.");
        this.setProject({ ...project, manifest: { ...project.manifest, citationStylePath: path } });
    }

    search(query: string): BookSearchMatch[] {
        const needle = query.trim().toLocaleLowerCase();
        if (needle.length === 0) return [];
        const project = this.current();
        const matches: BookSearchMatch[] = [];
        for (const entry of project.manifest.entries) {
            const source = project.files[entry.path];
            if (typeof source !== "string") continue;
            const lines = source.split(/\r?\n/);
            lines.forEach((line, index) => {
                if (line.toLocaleLowerCase().includes(needle)) {
                    matches.push({
                        entryId: entry.id,
                        path: entry.path,
                        title: entry.title,
                        line: index + 1,
                        excerpt: line.trim().slice(0, 240)
                    });
                }
            });
        }
        return matches;
    }

    replaceAll(query: string, replacement: string): number {
        const needle = query.trim();
        if (needle.length === 0) return 0;
        const project = this.current();
        const files = { ...project.files };
        let count = 0;
        for (const entry of project.manifest.entries) {
            const source = files[entry.path];
            if (typeof source !== "string") continue;
            const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(escaped, "gi");
            files[entry.path] = source.replace(pattern, () => {
                count += 1;
                return replacement;
            });
        }
        if (count > 0) this.setProject({ ...project, files });
        return count;
    }

    select(entryId: string): { readonly entry: BookEntry; readonly source: string } {
        const project = this.current();
        const entry = project.manifest.entries.find((candidate) => candidate.id === entryId);
        if (entry === undefined) throw new Error(`Unknown book entry: ${entryId}.`);
        const source = project.files[entry.path];
        if (typeof source !== "string") throw new Error(`The Markdown file for “${entry.title}” is missing.`);
        this.setActiveEntryId(entryId);
        return { entry, source };
    }

    resetToMarkdown(source: string, title: string): void {
        const project = createSingleChapterBook(source, title);
        this.open(project, project.manifest.entries[0]?.id);
    }

    addEntry(role: BookEntry["role"], title: string): BookEntry {
        const cleanedTitle = title.trim();
        if (cleanedTitle.length === 0) throw new Error("A section needs a title.");
        const project = this.current();
        const usedIds = new Set(project.manifest.entries.map((entry) => entry.id));
        let suffix = project.manifest.entries.length + 1;
        let id = `${role}-${suffix}`;
        while (usedIds.has(id)) id = `${role}-${++suffix}`;
        const directory = role === "chapter" ? "chapters" : role === "front-matter" ? "front-matter" : "back-matter";
        const base = slug(cleanedTitle);
        const usedPaths = new Set(project.manifest.entries.map((entry) => entry.path));
        let path = `${directory}/${base}.md`;
        let pathSuffix = 2;
        while (usedPaths.has(path)) path = `${directory}/${base}-${pathSuffix++}.md`;
        const entry: BookEntry = { id, role, path, title: cleanedTitle };
        this.setProject({
            ...project,
            manifest: { ...project.manifest, entries: [...project.manifest.entries, entry] },
            files: { ...project.files, [path]: `# ${cleanedTitle}\n\n` }
        });
        return entry;
    }

    renameEntry(entryId: string, title: string): void {
        const cleanedTitle = title.trim();
        if (cleanedTitle.length === 0) throw new Error("A section needs a title.");
        const project = this.current();
        const found = project.manifest.entries.some((entry) => entry.id === entryId);
        if (!found) throw new Error(`Unknown book entry: ${entryId}.`);
        this.setProject({
            ...project,
            manifest: {
                ...project.manifest,
                entries: project.manifest.entries.map((entry) =>
                    entry.id === entryId ? { ...entry, title: cleanedTitle } : entry
                )
            }
        });
    }

    reorderEntry(entryId: string, targetIndex: number): void {
        const project = this.current();
        const entries = [...project.manifest.entries];
        const index = entries.findIndex((entry) => entry.id === entryId);
        if (index < 0) throw new Error(`Unknown book entry: ${entryId}.`);
        const [entry] = entries.splice(index, 1);
        if (entry === undefined) return;
        const boundedIndex = Math.max(0, Math.min(entries.length, Math.trunc(targetIndex)));
        entries.splice(boundedIndex, 0, entry);
        this.setProject({ ...project, manifest: { ...project.manifest, entries } });
    }

    removeEntry(entryId: string): void {
        const project = this.current();
        const entry = project.manifest.entries.find((candidate) => candidate.id === entryId);
        if (entry === undefined) throw new Error(`Unknown book entry: ${entryId}.`);
        if (entry.role === "chapter" && project.manifest.entries.filter((candidate) => candidate.role === "chapter").length === 1) {
            throw new Error("A book must keep at least one chapter.");
        }
        const files = { ...project.files };
        delete files[entry.path];
        this.setProject({
            ...project,
            manifest: { ...project.manifest, entries: project.manifest.entries.filter((candidate) => candidate.id !== entryId) },
            files
        });
        if (this.activeEntryId() === entryId) {
            const next = project.manifest.entries.find((candidate) => candidate.id !== entryId);
            if (next !== undefined) this.setActiveEntryId(next.id);
        }
    }
}

function slug(title: string): string {
    return title.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}
