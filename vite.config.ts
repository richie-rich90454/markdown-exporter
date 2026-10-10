/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// Cookie-less Cloudflare Web Analytics (~11 KB) is only added when a token is
// supplied at build time: CLOUDFLARE_ANALYTICS_TOKEN=... pnpm run build
function cloudflareBeacon(): Plugin {
    return {
        name: "cloudflare-beacon",
        transformIndexHtml(html, context) {
            if (context.bundle === undefined) {
                return html;
            }
            const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
            if (token === undefined || token.length === 0) {
                return html;
            }
            const beacon =
                `<script defer src="https://static.cloudflareinsights.com` +
                `/static-cloudflareinsights/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>`;
            return html.replace("</body>", `    ${beacon}\n    </body>`);
        }
    };
}

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
                "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
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
    plugins: [solid(), cloudflareBeacon(), contentSecurityPolicy()],
    build: {
        target: "es2022"
    },
    test: {
        environment: "jsdom",
        include: ["tests/**/*.test.ts"]
    }
});
