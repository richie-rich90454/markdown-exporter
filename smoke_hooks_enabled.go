//go:build desktop_smoke

package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"os"
	"path/filepath"
)

// The test build selects a controlled output path instead of displaying a
// blocking picker. The real capability grant and disk write are unchanged.
func (a *App) saveDialog(options runtime.SaveDialogOptions) (string, error) {
	return filepath.Join(a.recoveryDir, options.DefaultFilename), nil
}

// Only the opt-in verification binary exposes this method.
func (a *App) SmokeResult(result string) error {
	if len(result) > 1024*1024 || !json.Valid([]byte(result)) {
		return errors.New("Invalid smoke report.")
	}
	root, err := a.recoveryRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	return atomicWrite(root, "smoke-result.json", []byte(result))
}

func (a *App) smokeDomReady(ctx context.Context) {
	restart := "false"
	if os.Getenv("MARKDOWN_EXPORTER_SMOKE_RESTART") == "1" {
		restart = "true"
	}
	runtime.WindowExecJS(ctx, `
    (async () => {
        const wait = async (condition, description) => {
            for (let attempt = 0; attempt < 600; attempt++) {
                if (condition()) return;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error("Timed out: " + description);
        };
        try {
            await wait(() => document.querySelector('.editor-file-action') && !document.querySelector('.editor-file-action').disabled, 'frontend startup');
            const source = '# Offline desktop\n\nA document with **formatting**, $x^2$, and a local renderer.\n\n| Feature | State |\n| --- | --- |\n| Desktop | Ready |\n\n' + String.fromCharCode(96).repeat(3) + 'mermaid\nflowchart LR\n  Write --> Preview --> Publish\n' + String.fromCharCode(96).repeat(3) + '\n';
            if (!`+restart+`) {
                await wait(() => document.querySelector('.rich-editor [role="textbox"]'), 'rich editor');
                const editor = document.querySelector('.rich-editor [role="textbox"]');
                editor.focus();
                const clipboard = new DataTransfer();
                clipboard.setData('text/plain', source);
                const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
                Object.defineProperty(event, 'clipboardData', { value: clipboard });
                editor.dispatchEvent(event);
            }
            await wait(() => document.querySelector('.preview__flow h1')?.textContent === 'Offline desktop', 'document recovery/preview');
            await wait(() => document.querySelector('.preview__flow .katex'), 'embedded math');
            await wait(() => document.querySelector('.preview__flow svg'), 'embedded diagrams');
            let denied = false;
            try { await window.go.main.App.ReadFile('not-a-granted-handle'); } catch { denied = true; }
            if (!denied) throw new Error('An ungranted file read was allowed');
            if (!`+restart+`) {
                for (const format of ['PDF','HTML','EPUB','Word document']) {
                    document.querySelector('[aria-label="Choose export format"]').click();
                    document.querySelector('[role="menuitem"][aria-label="' + format + '"]').click();
                    const expected = format === 'Word document' ? 'DOCX' : format;
                    await wait(() => document.querySelector('.statusbar').textContent.includes('Saved ' + expected), 'native ' + expected + ' export');
                }
            }
            await window.go.main.App.SmokeResult(JSON.stringify({ok:true,math:true,diagrams:true,denied:true}));
            window.runtime.Quit();
        } catch(error) {
            await window.go.main.App.SmokeResult(JSON.stringify({ok:false,error:String(error.stack || error)}));
            await window.go.main.App.ConfirmClose();
        }
    })();`)
}
