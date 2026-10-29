import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
    command,
    ["exec", "playwright", "test", "--grep", "@perf", "--workers=1"],
    {
        env: { ...process.env, MARKDOWN_RUN_PERF: "1" },
        shell: process.platform === "win32",
        stdio: "inherit"
    }
);

if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
