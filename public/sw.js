const CACHE_PREFIX = "markdown-exporter-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.add(new URL("index.html", self.registration.scope));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    const scope = new URL(self.registration.scope);
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const response = await fetch(request);
                if (response.ok) await cache.put(new URL("index.html", scope), response.clone());
                return response;
            } catch {
                return (await cache.match(new URL("index.html", scope))) ?? Response.error();
            }
        })());
        return;
    }

    if (!url.pathname.includes("/assets/")) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        const update = fetch(request).then(async (response) => {
            if (response.ok && response.type === "basic") await cache.put(request, response.clone());
            return response;
        });
        if (cached !== undefined) {
            event.waitUntil(update.catch(() => undefined));
            return cached;
        }
        try { return await update; }
        catch { return Response.error(); }
    })());
});
