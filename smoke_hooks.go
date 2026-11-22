//go:build !desktop_smoke

package main

import "context"
import "github.com/wailsapp/wails/v2/pkg/runtime"

func (a *App) saveDialog(options runtime.SaveDialogOptions) (string, error) {
	return runtime.SaveFileDialog(a.ctx, options)
}

// Production builds contain no smoke-test methods, injected script, or debugger.
func (a *App) smokeDomReady(_ context.Context) {}
