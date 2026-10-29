import type * as MermaidModule from "mermaid";

let mermaidModulePromise: Promise<typeof MermaidModule> | undefined;
let mermaidInitialized = false;
let zenumlRegistered = false;
let nextDiagramId = 0;

/** Load and render a single diagram only after the document contains one. */
export async function renderMermaid(source: string, needsZenUml = false): Promise<string> {
    mermaidModulePromise ??= import("mermaid");
    const mermaid = (await mermaidModulePromise).default;
    if (!mermaidInitialized) {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "default",
            htmlLabels: false
        });
        mermaidInitialized = true;
    }

    if (needsZenUml && !zenumlRegistered) {
        const zenuml = (await import("@mermaid-js/mermaid-zenuml")).default;
        await mermaid.registerExternalDiagrams([zenuml], { lazyLoad: false });
        zenumlRegistered = true;
    }

    const result = await mermaid.render(`markdown-exporter-diagram-${++nextDiagramId}`, source);
    return result.svg;
}
