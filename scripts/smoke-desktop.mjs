// The opt-in test binary uses the production frontend and CSP with an isolated
// profile. Its Go harness is completely excluded from release builds.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "win32") throw new Error("This smoke check targets Windows WebView2.");
const executable = path.resolve("build/bin/MarkdownExporterSmoke.exe");
await mkdir("test-results", { recursive: true });
const profile = await mkdtemp(path.resolve("test-results/native-profile-"));

async function run(restart) {
    const child = spawn(executable, [], {
        windowsHide: true,
        env: {
            ...process.env,
            MARKDOWN_EXPORTER_DATA_DIR: profile,
            MARKDOWN_EXPORTER_SMOKE_RESTART: restart ? "1" : "0"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    child.stdout.on("data", (data) => {
        log += data.toString();
    });
    child.stderr.on("data", (data) => {
        log += data.toString();
    });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Native smoke check timed out. ${log}`));
        }, 60000);
        child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once("exit", (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error(`App exited ${code}: ${log}`));
        });
    });
    const result = JSON.parse(await readFile(path.join(profile, "smoke-result.json"), "utf8"));
    if (!result.ok) throw new Error(result.error);
    const draft = JSON.parse(await readFile(path.join(profile, "draft.json"), "utf8"));
    if (!draft.source.includes("# Offline desktop") || !draft.source.includes("Write --> Preview"))
        throw new Error("Shutdown recovery lost content.");
}
await run(false);
for (const [extension, magic] of [
    ["pdf", "%PDF"],
    ["html", "<!doctype html>"],
    ["epub", "PK"],
    ["docx", "PK"]
]) {
    const data = await readFile(path.join(profile, `offline-desktop.${extension}`));
    if (!data.subarray(0, magic.length).equals(Buffer.from(magic)))
        throw new Error(`Invalid native ${extension} export.`);
}
await run(true);
process.stdout.write(
    "Packaged WebView2 passed: embedded math/diagrams, four native export formats, file access restrictions, safe shutdown, and recovery after restart.\n"
);
