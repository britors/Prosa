#!/usr/bin/env bash
# Instalador de conveniência sem sudo: baixa o pacote pré-compilado da
# release mais recente do Prosa e instala só para o usuário atual, em
# ~/.local — sem exigir root nem passar pelo gerenciador de pacotes da
# distro (diferente de scripts/install.sh, que instala via apt/dnf/zypper
# com privilégio de root).
#
# TODO: ajustar pra bater com o padrão exato do projeto de referência
# (link a confirmar) assim que disponível.
#
# Como o Prosa ainda não publica um tarball portátil pro Linux (só
# .deb/.rpm, gerados por .github/workflows/release.yml), a saída sem-sudo é
# extrair o pacote sem instalá-lo de fato no sistema:
#   .deb  -> `ar x` pra tirar o data.tar.* de dentro, depois extrai esse tar.
#   .rpm  -> `rpm2cpio | cpio -idm`.
#
# GTK4/libadwaita/enchant2 continuam sendo dependências de sistema
# (linkagem dinâmica) — este script não instala essas libs (não dá sem
# sudo). Ele confere com `ldd` se falta alguma e avisa, em vez de falhar
# silenciosamente depois.
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/britors/Prosa/main/scripts/install-user.sh | bash
#
# PROSA_VERSION=v6.0.0 bash install-user.sh   # trava numa tag específica
set -euo pipefail

REPO="britors/Prosa"
PREFIX="${PROSA_PREFIX:-$HOME/.local}"

distro_id=""
distro_id_like=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  distro_id="${ID:-}"
  distro_id_like="${ID_LIKE:-}"
fi

# download_release_asset baixa pra $workdir o (primeiro) asset da release
# cujo nome termina no sufixo passado, usando a API de releases do GitHub —
# mesma função de scripts/install.sh, só que sem precisar de root pra
# rodar curl.
download_release_asset() {
  local suffix="$1"
  local release_tag="${PROSA_VERSION:-latest}"
  local api_url
  if [ "$release_tag" = "latest" ]; then
    api_url="https://api.github.com/repos/$REPO/releases/latest"
  else
    api_url="https://api.github.com/repos/$REPO/releases/tags/$release_tag"
  fi

  echo "==> Consultando release ($release_tag) em $REPO" >&2
  local release_json
  release_json="$(curl -fsSL "$api_url")"

  local url
  url="$(printf '%s' "$release_json" \
    | grep -Eo "\"browser_download_url\": *\"[^\"]*${suffix}\"" \
    | sed -E 's/.*"(https:[^"]+)"/\1/' \
    | head -n1)"

  if [ -z "$url" ]; then
    echo "Erro: nenhum asset '*${suffix}' encontrado na release '$release_tag'." >&2
    echo "Confira se o workflow de release já rodou para essa tag:" >&2
    echo "  https://github.com/$REPO/releases" >&2
    exit 1
  fi

  echo "==> Baixando $(basename "$url")" >&2
  curl -fsSL "$url" -o "$workdir/$(basename "$url")"
  printf '%s' "$workdir/$(basename "$url")"
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

extract_root="$workdir/extracted"
mkdir -p "$extract_root"

case "$distro_id $distro_id_like" in
  *opensuse*|*suse*|*fedora*)
    if ! command -v rpm2cpio >/dev/null 2>&1 || ! command -v cpio >/dev/null 2>&1; then
      echo "Erro: 'rpm2cpio'/'cpio' não encontrados — necessários pra extrair o .rpm sem instalar." >&2
      exit 1
    fi
    package_path="$(download_release_asset '\.x86_64\.rpm')"
    echo "==> Extraindo $(basename "$package_path") (sem instalar)"
    (cd "$extract_root" && rpm2cpio "$package_path" | cpio -idm --quiet)
    ;;
  *debian*|*ubuntu*)
    if ! command -v ar >/dev/null 2>&1; then
      echo "Erro: 'ar' não encontrado — necessário pra extrair o .deb sem instalar." >&2
      exit 1
    fi
    package_path="$(download_release_asset '\.deb')"
    echo "==> Extraindo $(basename "$package_path") (sem instalar)"
    (cd "$workdir" && ar x "$package_path")
    data_tar="$(find "$workdir" -maxdepth 1 -name 'data.tar.*' | head -n1)"
    if [ -z "$data_tar" ]; then
      echo "Erro: não achei data.tar.* dentro do .deb." >&2
      exit 1
    fi
    tar -xf "$data_tar" -C "$extract_root"
    ;;
  *)
    echo "Distro não reconhecida (ID=$distro_id, ID_LIKE=$distro_id_like)." >&2
    echo "Este instalador cobre openSUSE Leap, Fedora e Ubuntu/Debian por enquanto." >&2
    echo "" >&2
    echo "Alternativa: compile a partir do código-fonte (veja o README," >&2
    echo "seção 'Como compilar e executar') ou baixe o .rpm/.deb manualmente em:" >&2
    echo "  https://github.com/$REPO/releases" >&2
    exit 1
    ;;
esac

extracted_bin="$extract_root/usr/bin/prosa"
if [ ! -f "$extracted_bin" ]; then
  echo "Erro: binário 'prosa' não encontrado dentro do pacote extraído." >&2
  exit 1
fi

echo "==> Instalando em $PREFIX (sem sudo)"
install -Dm755 "$extracted_bin" "$PREFIX/bin/prosa"

if [ -d "$extract_root/usr/share/applications" ]; then
  mkdir -p "$PREFIX/share/applications"
  cp "$extract_root"/usr/share/applications/*.desktop "$PREFIX/share/applications/"
fi

if [ -d "$extract_root/usr/share/icons/hicolor" ]; then
  mkdir -p "$PREFIX/share/icons/hicolor"
  cp -r "$extract_root"/usr/share/icons/hicolor/* "$PREFIX/share/icons/hicolor/"
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache "$PREFIX/share/icons/hicolor" -q || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" -q || true
fi

echo "==> Checando dependências de sistema"
missing_deps="$(ldd "$PREFIX/bin/prosa" 2>/dev/null | grep -i "not found" || true)"

cat <<EOF

Instalação concluída.
- App: $PREFIX/bin/prosa
EOF

case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *)
    cat <<EOF

"$PREFIX/bin" não está no seu PATH. Adicione ao seu shell (ex.: ~/.bashrc
ou ~/.zshrc):

    export PATH="$PREFIX/bin:\$PATH"
EOF
    ;;
esac

if [ -n "$missing_deps" ]; then
  cat <<EOF >&2

Aviso: faltam bibliotecas de sistema (GTK4/libadwaita/enchant2) que este
instalador não consegue colocar sem sudo:
$missing_deps
Instale-as com o gerenciador de pacotes da sua distro — veja o README,
seção "Como compilar e executar", para a lista de dependências.
EOF
fi

cat <<'EOF'

Empacotamento ainda é considerado de teste — reporte problemas em
https://github.com/britors/Prosa/issues.
EOF
