/* eslint-disable @typescript-eslint/require-await -- Service worker fakes mirror asynchronous browser APIs. */
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

let workerSource!: string;

beforeAll(async () => {
    workerSource = await readFile("public/sw.js", "utf8");
});

interface WorkerRequest {
    readonly method: string;
    readonly mode: string;
    readonly url: string;
}

interface WorkerResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: { get(name: string): string | null };
    clone(): WorkerResponse;
    text(): Promise<string>;
}

interface OfflineError {
    readonly offlineError: true;
}

interface WorkerEvent {
    readonly request?: WorkerRequest;
    waitUntil(value: Promise<unknown>): void;
    respondWith(value: Promise<WorkerResponse | OfflineError>): void;
}

function makeResponse(body: string, contentType = "text/plain"): WorkerResponse {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
        clone: () => makeResponse(body, contentType),
        text: async () => body
    };
}

function createWorkerHarness(baseUrl: string) {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const storedResponses = new Map<string, WorkerResponse>();
    const network = new Map<string, WorkerResponse>();
    let offline = false;
    let skippedWaiting = false;
    let claimedClients = false;
    const cacheName = "markdown-exporter-shell-v2";

    const requestUrl = (request: string | URL | WorkerRequest): string => {
        if (typeof request === "string") return new URL(request, baseUrl).href;
        return "url" in request ? request.url : request.href;
    };
    const cache = {
        put: async (request: string | URL | WorkerRequest, response: WorkerResponse) => {
            storedResponses.set(requestUrl(request), response.clone());
        },
        match: async (request: string | URL | WorkerRequest) =>
            storedResponses.get(requestUrl(request)),
        keys: async () => [...storedResponses.keys()].map((url) => ({ url }))
    };

    const self = {
        registration: { scope: baseUrl },
        clients: {
            claim: async () => {
                claimedClients = true;
            }
        },
        addEventListener: (type: string, handler: (event: WorkerEvent) => void) =>
            listeners.set(type, handler),
        skipWaiting: async () => {
            skippedWaiting = true;
        }
    };
    const caches = {
        open: async (name: string) => {
            expect(name).toBe(cacheName);
            return cache;
        },
        keys: async () => [cacheName],
        delete: async () => true
    };
    const fetch = async (input: string | URL | WorkerRequest): Promise<WorkerResponse> => {
        if (offline) throw new Error("offline");
        const url = requestUrl(input);
        const response = network.get(url);
        if (response === undefined) throw new Error(`Unexpected request: ${url}`);
        return response.clone();
    };

    runInNewContext(workerSource, {
        self,
        caches,
        fetch,
        URL,
        Response: { error: () => ({ offlineError: true }) }
    });

    const dispatch = async (type: string, request?: WorkerRequest) => {
        const pending: Promise<unknown>[] = [];
        let response: Promise<WorkerResponse | OfflineError> | undefined;
        const event = {
            ...(request === undefined ? {} : { request }),
            waitUntil: (value: Promise<unknown>) => pending.push(value),
            respondWith: (value: Promise<WorkerResponse | OfflineError>) => {
                response = value;
            }
        };
        listeners.get(type)?.(event);
        await Promise.all(pending);
        return {
            intercepted: response !== undefined,
            response: response === undefined ? undefined : await response
        };
    };

    return {
        addNetworkResponse: (url: string, body: string, contentType = "text/plain") => {
            network.set(new URL(url, baseUrl).href, makeResponse(body, contentType));
        },
        cacheKeys: () => [...storedResponses.keys()],
        dispatch,
        setOffline: (value: boolean) => {
            offline = value;
        },
        wasActivated: () => skippedWaiting && claimedClients
    };
}

describe("service worker static delivery", () => {
    it("precaches the first usable static shell and leaves dynamic features and documents out", async () => {
        const baseUrl = "https://example.test/writing/";
        const harness = createWorkerHarness(baseUrl);
        harness.addNetworkResponse(
            "index.html",
            '<link rel="stylesheet" href="./assets/style.css"><script type="module" src="./assets/app.js"></script>',
            "text/html"
        );
        harness.addNetworkResponse(
            "assets/app.js",
            'import{render}from"./shared.js";const loadMath=()=>import("./math.js");',
            "text/javascript"
        );
        harness.addNetworkResponse(
            "assets/shared.js",
            "export const render = () => {};",
            "text/javascript"
        );
        harness.addNetworkResponse(
            "assets/math.js",
            "export const math = true;",
            "text/javascript"
        );
        harness.addNetworkResponse(
            "assets/style.css",
            '@font-face{src:url("./font.woff2")}',
            "text/css"
        );
        harness.addNetworkResponse("assets/font.woff2", "font bytes", "font/woff2");

        await harness.dispatch("install");
        await harness.dispatch("activate");

        expect(harness.wasActivated()).toBe(true);
        expect(harness.cacheKeys()).toEqual(
            expect.arrayContaining([
                new URL("index.html", baseUrl).href,
                new URL("assets/app.js", baseUrl).href,
                new URL("assets/shared.js", baseUrl).href,
                new URL("assets/style.css", baseUrl).href,
                new URL("assets/font.woff2", baseUrl).href
            ])
        );
        expect(harness.cacheKeys()).not.toContain(new URL("assets/math.js", baseUrl).href);
        expect(harness.cacheKeys()).not.toContain(new URL("chapter.md", baseUrl).href);
    });

    it("falls back to the cached app entry offline without hijacking other pages or documents", async () => {
        const baseUrl = "https://example.test/writing/";
        const harness = createWorkerHarness(baseUrl);
        const index = '<script type="module" src="./assets/app.js"></script>';
        harness.addNetworkResponse("index.html", index, "text/html");
        harness.addNetworkResponse("assets/app.js", "export {};", "text/javascript");
        await harness.dispatch("install");
        harness.setOffline(true);

        const appNavigation = await harness.dispatch("fetch", {
            method: "GET",
            mode: "navigate",
            url: baseUrl
        });
        expect(appNavigation.intercepted).toBe(true);
        if (appNavigation.response === undefined || !("text" in appNavigation.response)) {
            throw new Error("The offline app navigation did not return the cached HTML response.");
        }
        expect(await appNavigation.response.text()).toBe(index);

        const privacyPage = await harness.dispatch("fetch", {
            method: "GET",
            mode: "navigate",
            url: new URL("privacy.html", baseUrl).href
        });
        expect(privacyPage.intercepted).toBe(false);

        const markdownFile = await harness.dispatch("fetch", {
            method: "GET",
            mode: "same-origin",
            url: new URL("chapters/opening.md", baseUrl).href
        });
        expect(markdownFile.intercepted).toBe(false);
    });
});
