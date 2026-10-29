const CACHE_PREFIX = "markdown-exporter-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const MAX_PRECACHE_RESOURCES = 128;

function scopedUrl(reference, base, scope) {
    let url;
    try {
        url = new URL(reference, base);
    } catch {
        return undefined;
    }
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return undefined;
    return url;
}

function staticJavaScriptImports(source) {
    const imports = [];
    const pattern =
        /\b(?:import\s*(?:[^"'();]*?\s*from\s*)?|export\s+[^"'();]*?\s*from\s*)["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) {
        const reference = match[1];
        if (reference !== undefined) imports.push(reference);
    }
    return imports;
}

function stylesheetReferences(source) {
    const references = [];
    const urlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]*?))\s*\)/gi;
    for (const match of source.matchAll(urlPattern)) {
        const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
        if (reference !== "") references.push(reference);
    }
    const importPattern = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;
    for (const match of source.matchAll(importPattern)) {
        const reference = match[1] ?? match[2];
        if (reference !== undefined) references.push(reference);
    }
    return references;
}

function appShellReferences(html, indexUrl, scope) {
    const references = [];
    const tags = html.matchAll(/<(?:script|link)\b[^>]*>/gi);
    for (const [tag] of tags) {
        const isScript = /^<script\b/i.test(tag);
        if (isScript && !/\btype\s*=\s*["']module["']/i.test(tag)) continue;
        if (!isScript && !/\brel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
        const attribute = isScript ? "src" : "href";
        const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
        const reference = match?.[2];
        const url = reference === undefined ? undefined : scopedUrl(reference, indexUrl, scope);
        if (url !== undefined) references.push(url);
    }
    return references;
}

async function precacheShell(cache, scope) {
    const indexUrl = new URL("index.html", scope);
    const response = await fetch(indexUrl, { cache: "reload", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Unable to cache the app shell (${response.status}).`);
    await cache.put(indexUrl, response.clone());

    const queue = appShellReferences(await response.text(), indexUrl, scope);
    const visited = new Set([indexUrl.href]);
    const assetsRoot = new URL("assets/", scope);

    while (queue.length > 0) {
        const url = queue.shift();
        if (url === undefined || visited.has(url.href)) continue;
        visited.add(url.href);
        if (visited.size > MAX_PRECACHE_RESOURCES) {
            throw new Error("The static app shell contains too many resources to cache safely.");
        }

        const assetResponse = await fetch(url, { credentials: "same-origin" });
        if (!assetResponse.ok)
            throw new Error(
                `Unable to cache app resource ${url.pathname} (${assetResponse.status}).`
            );
        const contentType = assetResponse.headers.get("content-type") ?? "";
        const isJavaScript =
            /(?:javascript|ecmascript)/i.test(contentType) || url.pathname.endsWith(".js");
        const isStylesheet = /text\/css/i.test(contentType) || url.pathname.endsWith(".css");
        await cache.put(url, assetResponse.clone());

        if (isJavaScript || isStylesheet) {
            const body = await assetResponse.text();
            const references = isJavaScript
                ? staticJavaScriptImports(body)
                : stylesheetReferences(body);
            for (const reference of references) {
                const dependency = scopedUrl(reference, url, scope);
                if (dependency === undefined || visited.has(dependency.href)) continue;
                // Only the initial application assets and their local CSS/font
                // dependencies are precached. Dynamic feature chunks are
                // fetched and cached on first use by the runtime handler.
                if (dependency.pathname.startsWith(assetsRoot.pathname)) queue.push(dependency);
            }
        }
    }
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await precacheShell(cache, new URL(self.registration.scope));
            await self.skipWaiting();
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    const scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

    const indexUrl = new URL("index.html", scope);
    const isAppShellNavigation =
        request.mode === "navigate" &&
        (url.pathname === scope.pathname || url.pathname === indexUrl.pathname);
    if (isAppShellNavigation) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                try {
                    const response = await fetch(request);
                    if (response.ok) await cache.put(indexUrl, response.clone());
                    return response;
                } catch {
                    return (await cache.match(indexUrl)) ?? Response.error();
                }
            })()
        );
        return;
    }

    const assetsRoot = new URL("assets/", scope);
    if (!url.pathname.startsWith(assetsRoot.pathname)) return;
    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(request);
            const update = fetch(request).then(async (response) => {
                if (response.ok) await cache.put(request, response.clone());
                return response;
            });
            if (cached !== undefined) {
                event.waitUntil(update.catch(() => undefined));
                return cached;
            }
            try {
                return await update;
            } catch {
                return Response.error();
            }
        })()
    );
});
