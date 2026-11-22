package main

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func fixtureFiles(t *testing.T) (*nativeFiles, string, *NativeEntry) {
	t.Helper()
	files := newNativeFiles()
	path := t.TempDir()
	t.Cleanup(files.close)
	root, err := files.grantPath(path, true)
	if err != nil {
		t.Fatal(err)
	}
	return files, path, root
}

func TestNativeBinaryRoundTripAndReplacement(t *testing.T) {
	files, path, root := fixtureFiles(t)
	entry, err := files.child(root.ID, "notes.md", "file", true)
	if err != nil {
		t.Fatal(err)
	}
	original := []byte("# Notes\n\n中文 and math $x^2$\x00\xff")
	encoded := base64.StdEncoding.EncodeToString(original)
	if err := files.write(entry.ID, encoded); err != nil {
		t.Fatal(err)
	}
	data, err := files.read(entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if data.Data != encoded {
		t.Fatal("binary contents changed")
	}
	if err := files.write(entry.ID, "not base64"); err == nil {
		t.Fatal("invalid data accepted")
	}
	actual, _ := os.ReadFile(filepath.Join(path, "notes.md"))
	if string(actual) != string(original) {
		t.Fatal("a failed write changed the original")
	}
	if err := files.write(entry.ID, base64.StdEncoding.EncodeToString([]byte("Replaced"))); err != nil {
		t.Fatal(err)
	}
	actual, _ = os.ReadFile(filepath.Join(path, "notes.md"))
	if string(actual) != "Replaced" {
		t.Fatal("the replacement was not committed")
	}
	entries, _ := os.ReadDir(path)
	if len(entries) != 1 {
		t.Fatal("temporary save files were left behind")
	}
}

func TestNativeCapabilitiesAndTraversal(t *testing.T) {
	files, _, root := fixtureFiles(t)
	for _, name := range []string{"", ".", "..", "../secret", "nested/file", `nested\file`, "C:secret", "bad\x00name"} {
		if _, err := files.child(root.ID, name, "file", true); err == nil {
			t.Fatalf("accepted unsafe name %q", name)
		}
	}
	if _, err := files.read("arbitrary-path"); err == nil {
		t.Fatal("ungranted read allowed")
	}
	entry, err := files.child(root.ID, "allowed.md", "file", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := files.child(entry.ID, "sibling.md", "file", true); err == nil {
		t.Fatal("file capability allowed sibling traversal")
	}
	if _, err := files.child(root.ID, "missing.md", "file", false); err == nil || err.Error()[:13] != "NotFoundError" {
		t.Fatalf("missing file did not report NotFoundError: %v", err)
	}
}

func TestNativeFoldersAndRollbackRemoval(t *testing.T) {
	files, _, root := fixtureFiles(t)
	folder, err := files.child(root.ID, "chapters", "directory", true)
	if err != nil {
		t.Fatal(err)
	}
	one, err := files.child(folder.ID, "one.md", "file", true)
	if err != nil {
		t.Fatal(err)
	}
	again, _ := files.child(folder.ID, "one.md", "file", false)
	if one.ID != again.ID {
		t.Fatal("repeated lookups leaked handles")
	}
	list, err := files.list(folder.ID)
	if err != nil || len(list) != 1 || list[0].Name != "one.md" {
		t.Fatalf("unexpected listing: %v, %v", list, err)
	}
	if err := files.remove(root.ID, "chapters"); err == nil {
		t.Fatal("directory removal allowed")
	}
	if err := files.remove(folder.ID, "one.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := files.read(one.ID); err == nil {
		t.Fatal("deleted file remained readable")
	}
}

func TestNativeRejectsSymlinksAndOversizedFiles(t *testing.T) {
	files, path, root := fixtureFiles(t)
	file, err := os.Create(filepath.Join(path, "large.md"))
	if err != nil {
		t.Fatal(err)
	}
	if err = file.Truncate(maxFileBytes + 1); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	large, _ := files.child(root.ID, "large.md", "file", false)
	if _, err := files.read(large.ID); err == nil {
		t.Fatal("oversized file read allowed")
	}
	outside := filepath.Join(t.TempDir(), "private.md")
	if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(path, "link.md")); err != nil {
		t.Skip("creating symbolic links requires OS permission")
	}
	if _, err := files.child(root.ID, "link.md", "file", false); err == nil {
		t.Fatal("symlink escape allowed")
	}
}

func TestAtomicWriteDoesNotReplaceDirectories(t *testing.T) {
	files, path, root := fixtureFiles(t)
	if err := os.Mkdir(filepath.Join(path, "keep"), 0700); err != nil {
		t.Fatal(err)
	}
	grant, _ := files.lookup(root.ID, "directory")
	if err := atomicWrite(grant.root, "keep", []byte("wrong")); err == nil {
		t.Fatal("directory was replaced")
	}
	if info, err := os.Stat(filepath.Join(path, "keep")); err != nil || !info.IsDir() {
		t.Fatal("original directory changed")
	}
}

func TestDesktopRecoveryIsDurableAndRejectsInvalidJSON(t *testing.T) {
	app := NewApp()
	app.recoveryDir = t.TempDir()
	t.Cleanup(app.files.close)
	original := `{"source":"# A local draft","savedAt":1}`
	if err := app.SaveRecovery(original); err != nil {
		t.Fatal(err)
	}
	if err := app.SaveRecovery("not JSON"); err == nil {
		t.Fatal("invalid snapshot accepted")
	}
	recovered, err := app.LoadRecovery()
	if err != nil || recovered != original {
		t.Fatalf("recovery changed: %q, %v", recovered, err)
	}
	root, err := app.recoveryRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if _, err := root.Stat("draft.json"); errors.Is(err, os.ErrNotExist) {
		t.Fatal("draft was not persisted")
	}
}
