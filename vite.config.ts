/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// The dev server injects inline scripts and styles for HMR, and the test
// build needs to load axe-core, so the policy is only shipped in ordinary
// production builds.
function contentSecurityPolicy(): Plugin {
    let mode = "production";
    return {
        name: "content-security-policy",
        configResolved(config) {
            mode = config.mode;
        },
        transformIndexHtml(html, context) {
            if (context.bundle === undefined || mode === "e2e") {
                return html;
            }
            const policy = [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob:",
                "font-src 'self' data:",
                "connect-src 'self' blob:",
                "worker-src 'self' blob:",
                "manifest-src 'self'",
                "form-action 'none'",
                "base-uri 'none'",
                "object-src 'none'",
                "frame-src 'none'"
            ].join("; ");
            return html.replace(
                "<head>",
                `<head>\n        <meta http-equiv="Content-Security-Policy" content="${policy}" />`
            );
        }
    };
}

export default defineConfig({
    // Relative asset URLs: the page is served both from the repository root and
    // from a project page such as username.github.io/markdown-exporter, and a
    // fixed base only works for one of the two.
    base: "./",
    plugins: [solid(), contentSecurityPolicy()],
    resolve: {
        // Mermaid and the editor/Markdown renderer depend on KaTeX through
        // different package ranges; resolve them to one runtime copy.
        dedupe: ["katex"]
    },
    build: {
        target: "es2022",
        // The manifest lets the budget checker follow exact static imports and
        // their CSS instead of guessing from minified JavaScript text.
        manifest: true,
        rolldownOptions: {
            output: {
                // Keep optional capabilities in independently cached chunks.
                // Each group is entry-aware so a document exporter cannot pull
                // the other exporters into its load path. The order safeguard
                // matters for packages that register extensions at module load.
                strictExecutionOrder: true,
                codeSplitting: {
                    groups: [
                        {
                            name: "diagram-vendor",
                            test: /node_modules[\\/](?:mermaid|@mermaid-js|dagre|@dagrejs)[\\/]/,
                            entriesAware: true,
                            minSize: 12 * 1024,
                            maxSize: 240 * 1024,
                            priority: 30
                        },
                        {
                            name: "publishing-vendor",
                            test: /node_modules[\\/](?:docx|@citation-js|fflate)[\\/]/,
                            entriesAware: true,
                            minSize: 12 * 1024,
                            maxSize: 220 * 1024,
                            priority: 20
                        },
                        {
                            name: "rich-editor-vendor",
                            test: /node_modules[\\/](?:@milkdown|prosemirror|@codemirror|@lezer)[\\/]/,
                            entriesAware: true,
                            minSize: 12 * 1024,
                            maxSize: 220 * 1024,
                            priority: 10
                        }
                    ]
                }
            }
        }
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.ts"]
    }
});
