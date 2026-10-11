import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

import { expect, test } from "@playwright/test";

// Serves the built site under the path a GitHub project page uses, so the
// relative asset URLs are proven before the page is published.
const server = createServer((request, response) => {
    void serve(request, response);
});

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const relative = normalize(url.pathname.replace(/^\/markdown-exporter\/?/, ""));
    const file = join(
        process.cwd(),
        "dist",
        relative === "\\" || relative === "." ? "index.html" : relative
    );
    try {
        const body = await readFile(file);
        const type = file.endsWith(".html")
            ? "text/html"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".js")
                ? "text/javascript"
                : "application/octet-stream";
        response.writeHead(200, { "content-type": type });
        response.end(body);
    } catch {
        response.writeHead(404);
        response.end("not found");
    }
}

function listen(): Promise<void> {
    return new Promise<void>((resolve) => {
        server.listen(4188, "127.0.0.1", () => {
            resolve();
        });
    });
}

test.skip(!existsSync("dist"), "run the build first");

test("serves the app from a project page path", async ({ page }) => {
    await listen();

    const failures: string[] = [];
    page.on("requestfailed", (request) => failures.push(request.url()));
    page.on("pageerror", (error) => failures.push(String(error)));

    await page.goto("http://127.0.0.1:4188/markdown-exporter/");
    await expect(page.getByLabel("Markdown editor")).toBeFocused();
    await page
        .getByLabel("Markdown editor")
        .fill("# Served from a project page\n\nBody text with a **bold** word.");
    await expect(page.locator(".preview__flow h1")).toHaveText("Served from a project page");
    await expect(page.locator(".page-canvas")).toHaveCount(1);
    await page.waitForTimeout(600);

    expect(failures).toEqual([]);

    const [privacy] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByRole("button", { name: "Privacy" }).click()
    ]);
    expect(privacy.url()).toBe("http://127.0.0.1:4188/markdown-exporter/privacy.html");
    await expect(privacy.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    server.close();
});
