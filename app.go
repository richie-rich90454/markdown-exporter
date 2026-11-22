package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx         context.Context
	files       *nativeFiles
	mu          sync.Mutex
	ready       bool
	closing     bool
	recoveryMu  sync.Mutex
	recoveryDir string
}

func NewApp() *App {
	dataDir := os.Getenv("MARKDOWN_EXPORTER_DATA_DIR")
	if dataDir == "" {
		if config, err := os.UserConfigDir(); err == nil {
			dataDir = filepath.Join(config, "MarkdownExporter")
		}
	} else if absolute, err := filepath.Abs(dataDir); err == nil {
		dataDir = absolute
	}
	return &App{files: newNativeFiles(), recoveryDir: dataDir}
}
func (a *App) startup(ctx context.Context) { a.ctx = ctx }
func (a *App) shutdown(_ context.Context)  { a.files.close() }

func (a *App) Ready() { a.mu.Lock(); a.ready = true; a.mu.Unlock() }
func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	prevent := a.ready && !a.closing
	a.mu.Unlock()
	if prevent {
		runtime.EventsEmit(ctx, "desktop:before-close")
	}
	return prevent
}
func (a *App) ConfirmClose() {
	a.files.writeMu.Lock()
	defer a.files.writeMu.Unlock()
	a.mu.Lock()
	a.closing = true
	a.mu.Unlock()
	runtime.Quit(a.ctx)
}

func (a *App) ShowPrivacy() error {
	_, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type: runtime.InfoDialog, Title: "Privacy · Markdown Exporter",
		Message: "Your writing stays on this computer.\n\nThe desktop app bundles its editor, fonts, math, diagrams, and exporters. It has no account, uploads, analytics, or telemetry.\n\nNative dialogs grant access only to files and folders you select. Recovery is stored in your local application configuration folder. Exported documents are saved where you choose.\n\nExternal links you open use your browser. Remote images may be unavailable offline; keep images in a book project for portable documents.",
		Buttons: []string{"Close"},
	})
	return err
}

func (a *App) ChooseFile(book bool) (*NativeEntry, error) {
	filter := runtime.FileFilter{DisplayName: "Markdown documents", Pattern: "*.md;*.markdown;*.mdown;*.mkd;*.txt"}
	if book {
		filter = runtime.FileFilter{DisplayName: "Markdown book project", Pattern: "*.mdbook"}
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open document", Filters: []runtime.FileFilter{filter}})
	if err != nil || path == "" {
		return nil, err
	}
	return a.files.grantPath(path, false)
}

func (a *App) ChooseSave(name string) (*NativeEntry, error) {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	if name == "." || name == "" {
		name = "document.md"
	}
	ext := filepath.Ext(name)
	path, err := a.saveDialog(runtime.SaveDialogOptions{
		Title: "Save " + name, DefaultFilename: name,
		Filters: []runtime.FileFilter{{DisplayName: strings.ToUpper(strings.TrimPrefix(ext, ".")) + " document", Pattern: "*" + ext}},
	})
	if err != nil || path == "" {
		return nil, err
	}
	if filepath.Ext(path) == "" {
		path += ext
	}
	return a.files.grantPath(path, false)
}

func (a *App) ChooseFolder() (*NativeEntry, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open Markdown or book folder", CanCreateDirectories: true})
	if err != nil || path == "" {
		return nil, err
	}
	return a.files.grantPath(path, true)
}
func (a *App) Child(id, name, kind string, create bool) (*NativeEntry, error) {
	return a.files.child(id, name, kind, create)
}
func (a *App) List(id string) ([]NativeEntry, error)   { return a.files.list(id) }
func (a *App) ReadFile(id string) (*NativeFile, error) { return a.files.read(id) }
func (a *App) WriteFile(id, data string) error         { return a.files.write(id, data) }
func (a *App) RemoveFile(id, name string) error        { return a.files.remove(id, name) }

func (a *App) recoveryRoot() (*os.Root, error) {
	path := a.recoveryDir
	if path == "" {
		config, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		path = filepath.Join(config, "MarkdownExporter")
	}
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	return os.OpenRoot(path)
}

func (a *App) LoadRecovery() (string, error) {
	a.recoveryMu.Lock()
	defer a.recoveryMu.Unlock()
	root, err := a.recoveryRoot()
	if err != nil {
		return "", err
	}
	defer root.Close()
	info, err := root.Stat("draft.json")
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if info.Size() > maxRecoveryBytes {
		return "", errors.New("The recovery file exceeds its safety limit.")
	}
	data, err := root.ReadFile("draft.json")
	return string(data), err
}

func (a *App) SaveRecovery(snapshot string) error {
	if len(snapshot) > maxRecoveryBytes || !json.Valid([]byte(snapshot)) {
		return errors.New("Invalid or oversized recovery snapshot.")
	}
	a.recoveryMu.Lock()
	defer a.recoveryMu.Unlock()
	root, err := a.recoveryRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	return atomicWrite(root, "draft.json", []byte(snapshot))
}
