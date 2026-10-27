import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const assetsDirectory = path.resolve("dist/assets");
const files = await readdir(assetsDirectory);

function findAsset(prefix, extension) {
    const match = files.find((name) => name.startsWith(prefix) && name.endsWith(extension));
    if (match === undefined) throw new Error(`Could not find the ${prefix} ${extension} build output.`);
    return match;
}

async function gzipBytes(name) {
    return gzipSync(await readFile(path.join(assetsDirectory, name))).byteLength;
}

async function staticClosure(roots) {
    const visited = new Set();
    const visit = async (name) => {
        if (visited.has(name)) return;
        visited.add(name);
        if (!name.endsWith(".js")) return;
        const code = await readFile(path.join(assetsDirectory, name), "utf8");
        const imports = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
        for (const match of code.matchAll(imports)) {
            const specifier = match[1] ?? match[2];
            if (specifier?.startsWith("./")) await visit(path.basename(specifier));
        }
    };
    for (const root of roots) await visit(root);
    return visited;
}

async function gzipTotal(names) {
    let total = 0;
    for (const name of names) total += await gzipBytes(name);
    return total;
}

function assertBudget(label, actual, limit) {
    if (actual > limit) {
        throw new Error(`${label} budget exceeded: ${(actual / 1024).toFixed(1)} KiB gzip (limit ${(limit / 1024).toFixed(0)} KiB).`);
    }
    process.stdout.write(`${label}: ${(actual / 1024).toFixed(1)} / ${(limit / 1024).toFixed(0)} KiB gzip\n`);
}

const shell = findAsset("index-", ".js");
const editor = findAsset("EditorPane-", ".js");
const rich = findAsset("RichMarkdownEditor-", ".js");
const renderer = findAsset("IncrementalMarkdownRenderer-", ".js");
const shellClosure = await staticClosure([shell]);
const initialClosure = await staticClosure([shell, editor, rich]);
const shellCss = findAsset("index-", ".css");
const richCss = findAsset("RichMarkdownEditor-", ".css");
const initialCss = new Set([shellCss, richCss]);
for (const asset of shellClosure) if (asset.endsWith(".css")) initialCss.add(asset);
for (const asset of initialClosure) if (asset.endsWith(".css")) initialCss.add(asset);

assertBudget("Static shell", await gzipTotal(new Set([...shellClosure, ...initialCss])), 100 * 1024);
assertBudget("Rich editor", await gzipBytes(rich), 225 * 1024);
assertBudget("Plain Markdown renderer", await gzipBytes(renderer), 125 * 1024);
assertBudget("Initial writing path", await gzipTotal(new Set([...initialClosure, ...initialCss])), 450 * 1024);

const eagerOptional = [...shellClosure].filter((name) =>
    /^(?:katex-|mermaid\.core-|PdfExporter-|HtmlExporter-|EpubExporter-|DocxExporter-|CitationPublisher-)/.test(name)
);
if (eagerOptional.length > 0) {
    throw new Error(`Optional feature chunks entered the static shell: ${eagerOptional.join(", ")}`);
}
