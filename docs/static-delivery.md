# Static delivery, offline use, and privacy

The application is a static browser app. It has no backend, login, analytics, or telemetry. The browser performs Markdown rendering, recovery, file access, and document export locally. The app does not upload document text, imported files, recovery drafts, books, or generated exports.

## Resource policy

Production HTML applies a Content Security Policy that permits scripts, fonts, images, and connections from the deployed site, with `data:` and `blob:` sources where local rendering and downloads need them. It denies frames, objects, forms, and base-URL overrides. External images and embeds are not loaded into the app. A link an author chooses to follow can still navigate to its destination.

## Offline cache

On HTTPS production sites, the service worker precaches the application entry page, its statically imported JavaScript, linked stylesheets, and same-site assets referenced by those stylesheets. This makes the initial writing workspace available after the first successful installation. Optional modules loaded through dynamic imports are cached when first requested, so an unused optional feature may need one online visit before it is available offline.

The service worker handles only the app entry navigation and same-site `/assets/` requests. It does not intercept the standalone privacy page or cache Markdown files, book projects, recovery drafts, or generated exports. Recovery data remains in IndexedDB with a local-storage fallback; the browser's Cache Storage holds only app resources. Browser storage can be evicted by the browser or removed when site data is cleared.

The app registers its service worker only for HTTPS production sites. The app continues to work online when service-worker support is unavailable or registration fails; offline startup then depends on whatever resources the browser has retained in its ordinary cache.

## Bundle budgets

The production build emits a Vite manifest. The budget checker follows only manifest `imports` for the static shell and initial writing path, and counts their associated CSS. Dynamic imports remain outside those initial-path totals. The enforced gzip limits are:

- Static shell, including its static JavaScript and CSS: 100 KiB.
- Rich editor entry chunk: 225 KiB.
- Plain Markdown renderer entry chunk: 125 KiB.
- Initial writing path, including shell, editor, rich editor, static dependencies, and CSS: 450 KiB.
- Individual editor vendor chunks: 260 KiB; diagram vendor chunks: 300 KiB; publishing vendor chunks: 280 KiB.

The entry-chunk limits do not replace the static-closure limits: each measures a different part of the app's loading path.
