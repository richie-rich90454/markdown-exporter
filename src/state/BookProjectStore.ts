import { createSignal, type Accessor, type Setter } from "solid-js";

import {
    createSingleChapterBook,
    assertSafeBookPath,
    canonicalBookPath,
    isBookManifestPath,
    updateBookChapter,
    validateBookProject,
    type BookEntry,
    type BookProject
} from "../domain/BookProject";
import { countMarkdownWords } from "../domain/BookWordCount";

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
    readonly isBookProject: Accessor<boolean>;

    private readonly setProject: Setter<BookProject>;
    private readonly setActiveEntryId: Setter<string>;
    private readonly setIsBookProject: Setter<boolean>;
    private readonly wordCountCache = new Map<string, { readonly source: string; readonly count: number }>();
    private wordCountLanguage: string | undefined;

    constructor() {
        const initial = createSingleChapterBook("");
        const [project, setProject] = createSignal(initial);
        const [activeEntryId, setActiveEntryId] = createSignal(
            initial.manifest.entries[0]?.id ?? "chapter-1"
        );
        const [isBookProject, setIsBookProject] = createSignal(false);
        this.current = project;
        this.activeEntryId = activeEntryId;
        this.isBookProject = isBookProject;
        this.setProject = setProject;
        this.setActiveEntryId = setActiveEntryId;
        this.setIsBookProject = setIsBookProject;
    }

    open(project: BookProject, activeEntryId?: string, isBookProject = true): void {
        const validatedProject = validateBookProject(project);
        const first = validatedProject.manifest.entries[0];
        const active = activeEntryId ?? first?.id ?? "";
        if (!validatedProject.manifest.entries.some((entry) => entry.id === active)) {
            throw new Error(`Unknown book entry: ${active}.`);
        }
        this.setProject(validatedProject);
        this.setActiveEntryId(active);
        this.setIsBookProject(isBookProject);
    }

    updateActive(source: string): void {
        const project = this.current();
        this.setProject(updateBookChapter(project, this.activeEntryId(), source));
    }

    updateMetadata(metadata: Partial<BookProject["manifest"]["metadata"]>): void {
        const project = this.current();
        const nextMetadata = { ...project.manifest.metadata };
        for (const key of [
            "title", "subtitle", "authors", "language", "publisher", "isbn", "description", "coverPath"
        ] as const) {
            if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
            const value = metadata[key];
            if (value === undefined) {
                if (key !== "title" && key !== "authors" && key !== "language") {
                    delete (nextMetadata as Partial<typeof nextMetadata>)[key];
                }
            } else if (key === "authors") {
                if (!Array.isArray(value) || !value.every((author) => typeof author === "string")) {
                    throw new Error("Book authors must be a list of text values.");
                }
                nextMetadata.authors = [...value];
            } else {
                if (typeof value !== "string") throw new Error(`Book metadata field ${key} must be text.`);
                Object.assign(nextMetadata, { [key]: value });
            }
        }
        const next = {
            ...project,
            manifest: {
                ...project.manifest,
                metadata: nextMetadata
            }
        };
        if (Object.prototype.hasOwnProperty.call(metadata, "coverPath")) {
            this.setProject(validateBookProject(next));
        } else {
            this.setProject(next);
        }
    }

    putFile(path: string, data: BookProject["files"][string]): void {
        assertSafeBookPath(path);
        if (isBookManifestPath(path)) throw new Error("The book.json manifest is managed by the book project.");
        if (typeof data !== "string" && !(data instanceof Uint8Array)) {
            throw new Error("Book files must contain text or binary data.");
        }
        const project = this.current();
        if (project.manifest.entries.some((entry) => canonicalBookPath(entry.path) === canonicalBookPath(path))) {
            throw new Error("Edit a section in the editor instead of replacing its file as an asset.");
        }
        const matchingPath = Object.keys(project.files).find((candidate) =>
            canonicalBookPath(candidate) === canonicalBookPath(path)
        );
        const targetPath = matchingPath ?? path;
        const files = { ...project.files };
        const storedData = data instanceof Uint8Array ? new Uint8Array(data) : data;
        Object.defineProperty(files, targetPath, { value: storedData, enumerable: true, configurable: true, writable: true });
        this.setProject(validateBookProject({ ...project, files }));
    }

    setBibliographyPath(path: string): void {
        assertSafeBookPath(path);
        const project = this.current();
        const existingPath = resolveFilePath(project, path);
        if (existingPath === undefined || typeof project.files[existingPath] !== "string") throw new Error("The bibliography file is missing.");
        this.setProject(validateBookProject({
            ...project,
            manifest: { ...project.manifest, bibliographyPath: existingPath }
        }));
    }

    setCitationStylePath(path: string): void {
        assertSafeBookPath(path);
        const project = this.current();
        const existingPath = resolveFilePath(project, path);
        if (existingPath === undefined || typeof project.files[existingPath] !== "string") throw new Error("The citation style file is missing.");
        this.setProject(validateBookProject({
            ...project,
            manifest: { ...project.manifest, citationStylePath: existingPath }
        }));
    }

    search(query: string): BookSearchMatch[] {
        const needle = query.trim().toLowerCase();
        if (needle.length === 0) return [];
        const project = this.current();
        const matches: BookSearchMatch[] = [];
        for (const entry of project.manifest.entries) {
            const source = project.files[entry.path];
            if (typeof source !== "string") continue;
            const lines = source.split(/\r?\n/);
            lines.forEach((line, index) => {
                const matchAt = line.toLowerCase().indexOf(needle);
                if (matchAt >= 0) {
                    const excerptStart = Math.max(0, matchAt - 80);
                    const excerptEnd = Math.min(line.length, matchAt + needle.length + 160);
                    matches.push({
                        entryId: entry.id,
                        path: entry.path,
                        title: entry.title,
                        line: index + 1,
                        excerpt: `${excerptStart > 0 ? "…" : ""}${line.slice(excerptStart, excerptEnd).trim()}${excerptEnd < line.length ? "…" : ""}`
                    });
                }
            });
        }
        return matches;
    }

    getChapterWordCount(entryId: string): number {
        const project = this.current();
        this.prepareWordCountCache(project.manifest.metadata.language);
        this.pruneWordCountCache(project);
        const entry = project.manifest.entries.find((candidate) => candidate.id === entryId);
        if (entry === undefined) throw new Error(`Unknown book entry: ${entryId}.`);
        return this.countChapterWordCount(project, entry);
    }

    getManuscriptWordCount(): number {
        const project = this.current();
        this.prepareWordCountCache(project.manifest.metadata.language);
        this.pruneWordCountCache(project);
        return project.manifest.entries.reduce((total, entry) => {
            return total + this.countChapterWordCount(project, entry);
        }, 0);
    }

    private countChapterWordCount(project: BookProject, entry: BookEntry): number {
        const source = project.files[entry.path];
        if (typeof source !== "string") return 0;
        const cached = this.wordCountCache.get(entry.id);
        if (cached?.source === source) return cached.count;
        const count = countMarkdownWords(source, project.manifest.metadata.language);
        this.wordCountCache.set(entry.id, { source, count });
        return count;
    }

    private prepareWordCountCache(language: string): void {
        if (this.wordCountLanguage === language) return;
        this.wordCountCache.clear();
        this.wordCountLanguage = language;
    }

    private pruneWordCountCache(project: BookProject): void {
        const entryIds = new Set(project.manifest.entries.map((entry) => entry.id));
        for (const entryId of this.wordCountCache.keys()) {
            if (!entryIds.has(entryId)) this.wordCountCache.delete(entryId);
        }
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
        this.open(project, project.manifest.entries[0]?.id, false);
    }

    markAsBookProject(): void {
        this.setIsBookProject(true);
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
        const usedPaths = new Set(Object.keys(project.files).map(canonicalBookPath));
        if (project.manifest.metadata.coverPath !== undefined) usedPaths.add(canonicalBookPath(project.manifest.metadata.coverPath));
        if (project.manifest.bibliographyPath !== undefined) usedPaths.add(canonicalBookPath(project.manifest.bibliographyPath));
        if (project.manifest.citationStylePath !== undefined) usedPaths.add(canonicalBookPath(project.manifest.citationStylePath));
        let path = `${directory}/${base}.md`;
        let pathSuffix = 2;
        while (usedPaths.has(canonicalBookPath(path))) path = `${directory}/${base}-${pathSuffix++}.md`;
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
        if (!Number.isFinite(targetIndex)) throw new Error("A section position must be a finite number.");
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
        if (canonicalBookPath(project.manifest.metadata.coverPath ?? "") === canonicalBookPath(entry.path)) {
            throw new Error("Remove or change the book cover before removing its section file.");
        }
        if (canonicalBookPath(project.manifest.bibliographyPath ?? "") === canonicalBookPath(entry.path)) {
            throw new Error("Change the bibliography file before removing its section file.");
        }
        if (canonicalBookPath(project.manifest.citationStylePath ?? "") === canonicalBookPath(entry.path)) {
            throw new Error("Change the citation style before removing its section file.");
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
    return title.toLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";
}

function resolveFilePath(project: BookProject, path: string): string | undefined {
    const pathKey = canonicalBookPath(path);
    return Object.keys(project.files).find((candidate) => canonicalBookPath(candidate) === pathKey);
}
