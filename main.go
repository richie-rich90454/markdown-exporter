package main

import (
	"embed"
	"log"
	"path/filepath"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// All frontend chunks, fonts, diagrams, and export engines ship in the binary.
//
//go:embed all:dist
var assets embed.FS

func main() {
	app := NewApp()
	appMenu := menu.NewMenu()
	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
	}
	file := appMenu.AddSubmenu("File")
	action := func(name string) func(*menu.CallbackData) {
		return func(_ *menu.CallbackData) { runtime.EventsEmit(app.ctx, "desktop:command", name) }
	}
	file.AddText("New document…", keys.CmdOrCtrl("n"), action("new"))
	file.AddText("Open document…", keys.CmdOrCtrl("o"), action("open"))
	file.AddText("Open book…", nil, action("open-book"))
	file.AddText("Open folder…", nil, action("open-folder"))
	file.AddSeparator()
	// Save uses the editor's existing shortcut so one keypress cannot save twice.
	file.AddText("Save", nil, action("save"))
	file.AddText("Save as…", keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), action("save-as"))
	file.AddText("Save book…", nil, action("save-book"))
	file.AddText("Export…", nil, action("export"))
	file.AddSeparator()
	file.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) { runtime.Quit(app.ctx) })
	if goruntime.GOOS == "darwin" {
		appMenu.Append(menu.EditMenu())
	}
	view := appMenu.AddSubmenu("View")
	view.AddText("Focus mode", nil, action("focus"))
	view.AddText("Page setup…", nil, action("page-setup"))
	view.AddText("Keyboard shortcuts", nil, action("shortcuts"))
	if err := wails.Run(&options.App{
		Title: "Markdown Exporter", Width: 1360, Height: 900, MinWidth: 760, MinHeight: 560,
		BackgroundColour: &options.RGBA{R: 247, G: 247, B: 247, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnDomReady:       app.smokeDomReady,
		OnStartup:        app.startup, OnShutdown: app.shutdown, OnBeforeClose: app.beforeClose,
		EnableDefaultContextMenu: true, Menu: appMenu,
		Windows: &windows.Options{WebviewUserDataPath: filepath.Join(app.recoveryDir, "webview"), IsZoomControlEnabled: false},
		Bind:    []interface{}{app},
	}); err != nil {
		log.Fatal(err)
	}
}
