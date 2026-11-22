package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const maxFileBytes = 256 * 1024 * 1024
const maxRecoveryBytes = 384 * 1024 * 1024
const maxHandles = 24000

// Only opaque capabilities cross the bridge. Paths originate in native pickers,
// and os.Root confines every child operation even if symlinks change concurrently.
type nativeFiles struct {
	mu      sync.Mutex
	writeMu sync.Mutex
	handles map[string]fileGrant
	keys    map[string]string
	roots   []*os.Root
}

type fileGrant struct {
	root     *os.Root
	relative string
	name     string
	kind     string
}

type NativeEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type NativeFile struct {
	Data     string `json:"data"`
	Modified int64  `json:"modified"`
}

func newNativeFiles() *nativeFiles {
	return &nativeFiles{handles: make(map[string]fileGrant), keys: make(map[string]string)}
}

func randomID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(value[:])
}

func (n *nativeFiles) register(grant fileGrant) (*NativeEntry, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	key := fmt.Sprintf("%p:%s:%s", grant.root, grant.relative, grant.kind)
	if id, ok := n.keys[key]; ok {
		return &NativeEntry{id, grant.name, grant.kind}, nil
	}
	if len(n.handles) >= maxHandles {
		return nil, errors.New("Too many open file handles; restart the app after saving your work.")
	}
	id := randomID()
	n.handles[id] = grant
	n.keys[key] = id
	return &NativeEntry{id, grant.name, grant.kind}, nil
}

func (n *nativeFiles) grantPath(path string, directory bool) (*NativeEntry, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	rootPath, relative, kind := filepath.Dir(path), filepath.Base(path), "file"
	if directory {
		rootPath, relative, kind = path, ".", "directory"
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, err
	}
	n.mu.Lock()
	n.roots = append(n.roots, root)
	n.mu.Unlock()
	return n.register(fileGrant{root, relative, filepath.Base(path), kind})
}

func (n *nativeFiles) lookup(id, kind string) (fileGrant, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	grant, ok := n.handles[id]
	if !ok || grant.kind != kind {
		return fileGrant{}, errors.New("Access denied: select the file or folder using a native dialog first.")
	}
	return grant, nil
}

func validLeaf(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\:\x00") && filepath.Base(name) == name
}

func fileError(err error) error {
	if errors.Is(err, fs.ErrNotExist) {
		return errors.New("NotFoundError: the file or folder no longer exists.")
	}
	return err
}

func (n *nativeFiles) child(parentID, name, kind string, create bool) (*NativeEntry, error) {
	if !validLeaf(name) || (kind != "file" && kind != "directory") {
		return nil, errors.New("Invalid child name.")
	}
	parent, err := n.lookup(parentID, "directory")
	if err != nil {
		return nil, err
	}
	path := filepath.Join(parent.relative, name)
	if create {
		if kind == "directory" {
			err = parent.root.Mkdir(path, 0700)
			if errors.Is(err, fs.ErrExist) {
				err = nil
			}
		} else {
			var file *os.File
			file, err = parent.root.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if file != nil {
				_ = file.Close()
			}
			if errors.Is(err, fs.ErrExist) {
				err = nil
			}
		}
		if err != nil {
			return nil, fileError(err)
		}
	}
	info, err := parent.root.Lstat(path)
	if err != nil {
		return nil, fileError(err)
	}
	if info.Mode()&os.ModeSymlink != 0 || (kind == "directory" && !info.IsDir()) || (kind == "file" && !info.Mode().IsRegular()) {
		return nil, errors.New("Only regular files and directories can be opened; symbolic links are not followed.")
	}
	return n.register(fileGrant{parent.root, path, name, kind})
}

func (n *nativeFiles) list(id string) ([]NativeEntry, error) {
	grant, err := n.lookup(id, "directory")
	if err != nil {
		return nil, err
	}
	folder, err := grant.root.Open(grant.relative)
	if err != nil {
		return nil, fileError(err)
	}
	defer folder.Close()
	entries, err := folder.ReadDir(10001)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	if len(entries) > 10000 {
		return nil, errors.New("The directory contains more than 10,000 entries.")
	}
	result := make([]NativeEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		kind := "file"
		if entry.IsDir() {
			kind = "directory"
		} else if !entry.Type().IsRegular() {
			continue
		}
		child, err := n.child(id, entry.Name(), kind, false)
		if err != nil {
			return nil, err
		}
		result = append(result, *child)
	}
	return result, nil
}

func (n *nativeFiles) read(id string) (*NativeFile, error) {
	grant, err := n.lookup(id, "file")
	if err != nil {
		return nil, err
	}
	info, err := grant.root.Lstat(grant.relative)
	if err != nil {
		return nil, fileError(err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("Only regular files can be read.")
	}
	if info.Size() > maxFileBytes {
		return nil, errors.New("The file exceeds the 256 MiB limit.")
	}
	file, err := grant.root.Open(grant.relative)
	if err != nil {
		return nil, fileError(err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxFileBytes {
		return nil, errors.New("The file exceeds the 256 MiB limit.")
	}
	return &NativeFile{base64.StdEncoding.EncodeToString(data), info.ModTime().UnixMilli()}, nil
}

func atomicWrite(root *os.Root, path string, data []byte) error {
	info, err := root.Lstat(path)
	mode := fs.FileMode(0600)
	if err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("The save target must be a regular file.")
		}
		mode = info.Mode().Perm()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	temp := filepath.Join(filepath.Dir(path), ".markdown-exporter-"+randomID()+".tmp")
	file, err := root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer root.Remove(temp)
	if _, err = file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	// Both names share a directory and filesystem. Rename never truncates the
	// original first, so a failed replacement leaves the original recoverable.
	return root.Rename(temp, path)
}

func (n *nativeFiles) write(id, encoded string) error {
	grant, err := n.lookup(id, "file")
	if err != nil {
		return err
	}
	if len(encoded) > base64.StdEncoding.EncodedLen(maxFileBytes) {
		return errors.New("The file exceeds the 256 MiB limit.")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return errors.New("Invalid file data.")
	}
	n.writeMu.Lock()
	defer n.writeMu.Unlock()
	return atomicWrite(grant.root, grant.relative, data)
}

func (n *nativeFiles) remove(parentID, name string) error {
	if !validLeaf(name) {
		return errors.New("Invalid child name.")
	}
	grant, err := n.lookup(parentID, "directory")
	if err != nil {
		return err
	}
	path := filepath.Join(grant.relative, name)
	info, err := grant.root.Lstat(path)
	if err != nil {
		return fileError(err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("Only regular project files can be removed.")
	}
	n.writeMu.Lock()
	defer n.writeMu.Unlock()
	return grant.root.Remove(path)
}

func (n *nativeFiles) close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	for _, root := range n.roots {
		_ = root.Close()
	}
}
