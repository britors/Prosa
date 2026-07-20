#!/usr/bin/env bash
# Instalador local: compila o Prosa a partir do código-fonte deste
# repositório (cargo build --release) e instala nos mesmos caminhos usados
# pelos pacotes .rpm/.deb oficiais (ver [package.metadata.generate-rpm] e
# [package.metadata.deb] em native/prosa-gtk/Cargo.toml).
#
# Diferença para scripts/install.sh: aquele baixa o binário pré-compilado da
# release do GitHub; este compila o código local, útil pra testar mudanças
# antes de publicar uma release.
#
# Uso:
#   ./scripts/install-local.sh
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
native_dir="$repo_root/native"
gtk_dir="$native_dir/prosa-gtk"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Erro: 'cargo' não encontrado. Instale o Rust antes de continuar:" >&2
  echo "  https://rustup.rs" >&2
  exit 1
fi

echo "==> Compilando (release)"
(cd "$native_dir" && cargo build --release --workspace)

bin_src="$native_dir/target/release/prosa"
if [ ! -f "$bin_src" ]; then
  echo "Erro: binário não encontrado em $bin_src" >&2
  exit 1
fi

echo "==> Instalando em /usr (pode pedir senha do sudo)"
sudo install -Dm755 "$bin_src" /usr/bin/prosa
sudo install -Dm644 \
  "$gtk_dir/data/br.com.rodrigobrito.Prosa.Native.desktop" \
  /usr/share/applications/br.com.rodrigobrito.Prosa.Native.desktop

for size in 48 64 128 256; do
  sudo install -Dm644 \
    "$gtk_dir/data/icons/hicolor/${size}x${size}/apps/br.com.rodrigobrito.Prosa.Native.png" \
    "/usr/share/icons/hicolor/${size}x${size}/apps/br.com.rodrigobrito.Prosa.Native.png"
done

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  sudo gtk-update-icon-cache /usr/share/icons/hicolor -q || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  sudo update-desktop-database /usr/share/applications -q || true
fi

cat <<'EOF'

Instalação concluída.
- App: /usr/bin/prosa (ou pelo atalho "Prosa" no menu)
EOF
