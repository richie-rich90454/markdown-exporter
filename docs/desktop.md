# Desktop app

The Wails desktop build uses the same Solid editor, renderer, page-layout engine, and PDF, Word, HTML, and EPUB exporters as the web app. There is no second editor implementation. Compiled JavaScript chunks, fonts, math, and diagrams are embedded in the executable, including optional features not previously opened.

## Build and run

Requirements: Go 1.26+, Node 24+, pnpm 12.10.1, and Wails CLI 2.16.0. Install the pinned CLI with `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`.

```sh
pnpm install --frozen-lockfile
pnpm desktop:build
```

On Windows this produces `build/bin/MarkdownExporter.exe`. The system needs Microsoft Edge WebView2 Runtime installed. The default `-webview2 error` strategy gives a clear error when it is missing; it does not download a runtime when launching offline. To distribute to machines without WebView2, provision the standalone runtime ahead of time or use Wails' fixed-runtime deployment options.

For development, run `pnpm desktop:dev`. Wails starts the existing Vite frontend and the Go host together.

macOS builds require Xcode command line tools. Linux builds require GTK 3 and WebKitGTK development packages; on Ubuntu 24.04 install `build-essential libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config`, then run `wails build -trimpath -tags webkit2_41`. Build each OS on that OS. The desktop CI workflow provides native Windows, macOS, and Linux build jobs. Windows is the locally validated package; CI results establish the other platforms' build status.

## Files and recovery

Native dialogs open Markdown files, `.mdbook` archives, and folders. Save writes back to the selected file; Save as chooses another target. All four publication formats use native save dialogs. Cancelling a dialog leaves the current work in place and does not report success.

Only files or folders chosen through native dialogs are accessible to the frontend. The bridge exposes opaque identifiers, not unrestricted path APIs. Child operations stay inside a Go `os.Root`; traversal, device paths, special files, and symbolic-link entries are rejected. A save writes and flushes a temporary sibling before replacing the original. Folder projects keep the existing rollback and manifest-last protocol.

Desktop draft recovery is an atomically replaced `draft.json` in the application configuration directory: `%APPDATA%/MarkdownExporter` on Windows, `~/Library/Application Support/MarkdownExporter` on macOS, and `$XDG_CONFIG_HOME/MarkdownExporter` (normally `~/.config/MarkdownExporter`) on Linux. Full book metadata, chapters, and binary assets are retained. Normal closing flushes the current rich-editor input and waits for recovery; if recovery fails, the window stays open with an actionable error. Keep separate Markdown or `.mdbook` saves as backups.

Set `MARKDOWN_EXPORTER_DATA_DIR` before launch to use another local profile directory, for example a portable-drive profile. Windows WebView2 profile data also lives beneath this directory. Recovery contains your writing as readable local data; protect that folder as you would your documents.

## Offline behavior

The desktop app does not need a web server, account, or internet access after installation. The browser build and its service worker remain available separately. Desktop builds do not register that service worker because their assets already ship in the executable.

Remote images and external links still require their destinations to be available. For portable books, include image and bibliography assets in the book folder or archive. The app does not fetch missing local files outside a selected folder or grant permission based on Markdown content.

Native File and View menus expose document, folder, export, focus, page setup, and shortcut actions. Existing rich/source/inline editing, shared undo, search, manuscript management, citation tools, custom pages, math, diagrams, and exports remain in the shared frontend.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:matrix
pnpm build:desktop
go test ./...
go vet ./...
pnpm desktop:build
```

Go tests exercise real native file IO, capability boundaries, binary fidelity, replacement safety, and recovery. Frontend tests cover native bridge cancellation, exports, ordered recovery writes, and shutdown failures. Browser suites continue to exercise the complete web app. Artwork sources and regeneration instructions are in [brand.md](brand.md).

On Windows, `pnpm desktop:smoke` also builds and launches an opt-in test executable in the real WebView2 runtime. It checks embedded math and diagrams, rejects ungranted file access, saves all four export formats through the native bridge, then closes and restarts to verify durable recovery. It uses an isolated profile under `test-results` and a controlled save-dialog replacement. The harness and its reporting method are excluded from normal release builds by a Go build tag.

Closing is blocked while a complete save or backup operation is in progress, including multi-file folder transactions. If writing changes during shutdown recovery, the app saves another snapshot before confirming close.
