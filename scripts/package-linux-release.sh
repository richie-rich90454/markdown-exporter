#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: package-linux-release.sh <version> [output-directory]}"
output_dir="${2:-release-assets}"
version="${version#v}"
binary="build/bin/MarkdownExporter"

if [[ ! -x "$binary" ]]; then
    printf 'Expected executable was not produced: %s\n' "$binary" >&2
    exit 1
fi

architecture="$(dpkg --print-architecture)"
if [[ "$architecture" != "amd64" && "$architecture" != "arm64" ]]; then
    printf 'Unsupported Debian package architecture: %s\n' "$architecture" >&2
    exit 1
fi

mkdir -p "$output_dir"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

tar_root="$temporary_root/tarball"
install -d "$tar_root"
install -m 0755 "$binary" "$tar_root/MarkdownExporter"
cat > "$tar_root/README-Linux.txt" <<'EOF'
Markdown Exporter requires GTK 3 and WebKitGTK 4.1 runtime libraries.
On Ubuntu 24.04, install libgtk-3-0 and libwebkit2gtk-4.1-0.
Run ./MarkdownExporter to start the app. The desktop application profile
and recoverable drafts are stored in the standard local config directory.
EOF

tar_name="MarkdownExporter-${version}-linux-${architecture}.tar.gz"
tar -czf "$output_dir/$tar_name" -C "$tar_root" MarkdownExporter README-Linux.txt

deb_root="$temporary_root/deb"
install -d "$deb_root/DEBIAN"
install -D -m 0755 "$binary" "$deb_root/usr/bin/markdown-exporter"
install -D -m 0644 public/brand/icon.svg \
    "$deb_root/usr/share/icons/hicolor/scalable/apps/markdown-exporter.svg"
install -D -m 0644 /dev/stdin "$deb_root/usr/share/applications/markdown-exporter.desktop" <<'EOF'
[Desktop Entry]
Name=Markdown Exporter
Comment=Private Markdown writing and publishing
Exec=markdown-exporter
Icon=markdown-exporter
Terminal=false
Type=Application
Categories=Office;WordProcessor;
StartupNotify=true
EOF
cat > "$deb_root/DEBIAN/control" <<EOF
Package: markdown-exporter
Version: ${version}
Section: editors
Priority: optional
Architecture: ${architecture}
Maintainer: Markdown Exporter <richie-rich90454@users.noreply.github.com>
Depends: libgtk-3-0, libwebkit2gtk-4.1-0
Homepage: https://github.com/richie-rich90454/markdown-exporter
Description: Private Markdown writing and publishing
 An offline-capable Markdown editor and publishing application.
EOF

deb_name="MarkdownExporter-${version}-linux-${architecture}.deb"
dpkg-deb --root-owner-group --build "$deb_root" "$output_dir/$deb_name"

printf 'Created %s\n' "$output_dir/$tar_name" "$output_dir/$deb_name"
