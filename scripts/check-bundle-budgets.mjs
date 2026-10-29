import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const outputDirectory = path.resolve("dist");
const assetsDirectory = path.join(outputDirectory, "assets");
const manifestPath = path.join(outputDirectory, ".vite", "manifest.json");
const [files, manifestSource] = await Promise.all([
    readdir(assetsDirectory),
    readFile(manifestPath, "utf8")
]);
const manifest = JSON.parse(manifestSource);

function findAsset(prefix, extension) {
    const match = files.find((name) => name.startsWith(prefix) && name.endsWith(extension));
    if (match === undefined)
        throw new Error(`Could not find the ${prefix} ${extension} build output.`);
    return match;
}

function findManifestRecord(file) {
    const record = Object.values(manifest).find(
        (entry) => path.posix.basename(entry.file) === file
    );
    if (record === undefined) throw new Error(`The Vite manifest has no record for ${file}.`);
    return record;
}

async function gzipBytes(name) {
    return gzipSync(await readFile(path.join(assetsDirectory, name))).byteLength;
}

function staticClosure(roots) {
    const visited = new Set();
    const css = new Set();
    const visit = (record) => {
        const filename = path.posix.basename(record.file);
        if (visited.has(filename)) return;
        visited.add(filename);
        for (const stylesheet of record.css ?? []) css.add(path.posix.basename(stylesheet));
        for (const importedKey of record.imports ?? []) {
            const imported = manifest[importedKey];
            if (imported === undefined)
                throw new Error(`The Vite manifest is missing import ${importedKey}.`);
            visit(imported);
        }
    };
    for (const root of roots) visit(findManifestRecord(root));
    return new Set([...visited, ...css]);
}

async function gzipTotal(names) {
    let total = 0;
    for (const name of names) total += await gzipBytes(name);
    return total;
}

function assertBudget(label, actual, limit) {
    if (actual > limit) {
        throw new Error(
            `${label} budget exceeded: ${(actual / 1024).toFixed(1)} KiB gzip (limit ${(limit / 1024).toFixed(0)} KiB).`
        );
    }
    process.stdout.write(
        `${label}: ${(actual / 1024).toFixed(1)} / ${(limit / 1024).toFixed(0)} KiB gzip\n`
    );
}

const shell = findAsset("index-", ".js");
const editor = findAsset("EditorPane-", ".js");
const rich = findAsset("RichMarkdownEditor-", ".js");
const renderer = findAsset("IncrementalMarkdownRenderer-", ".js");
const shellClosure = staticClosure([shell]);
const initialClosure = staticClosure([shell, editor, rich]);

assertBudget("Static shell", await gzipTotal(shellClosure), 100 * 1024);
assertBudget("Rich editor", await gzipBytes(rich), 225 * 1024);
assertBudget("Plain Markdown renderer", await gzipBytes(renderer), 125 * 1024);
assertBudget("Initial writing path", await gzipTotal(initialClosure), 450 * 1024);

const eagerOptional = [...shellClosure].filter((name) =>
    /^(?:katex-|mermaid(?:\.core|-)|diagram-vendor-|publishing-vendor-|PdfExporter-|HtmlExporter-|EpubExporter-|DocxExporter-|CitationPublisher-)/.test(
        name
    )
);
if (eagerOptional.length > 0) {
    throw new Error(
        `Optional feature chunks entered the static shell: ${eagerOptional.join(", ")}`
    );
}

const bundleGroups = [
    { label: "Rich editor vendor", prefix: "rich-editor-vendor-", limit: 260 * 1024 },
    { label: "Diagram vendor", prefix: "diagram-vendor-", limit: 300 * 1024 },
    { label: "Publishing vendor", prefix: "publishing-vendor-", limit: 280 * 1024 }
];
for (const group of bundleGroups) {
    for (const name of files.filter(
        (asset) => asset.startsWith(group.prefix) && asset.endsWith(".js")
    )) {
        assertBudget(group.label, await gzipBytes(name), group.limit);
    }
}
