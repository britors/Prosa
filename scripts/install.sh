#!/usr/bin/env bash
# Instalador de conveniência: baixa os pacotes pré-compilados da release mais
# recente do Prosa (app nativo Rust + GTK4) e instala com o gerenciador de
# pacotes da distro. Cobre openSUSE Leap/Fedora (.rpm) e Ubuntu/Debian (.deb),
# ambos gerados por .github/workflows/release.yml.
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/britors/Prosa/main/scripts/install.sh | sudo bash
#
# PROSA_VERSION=v5.0.0 sudo -E bash install.sh   # trava numa tag específica
set -euo pipefail

REPO="britors/Prosa"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root (sudo bash install.sh, ou via curl ... | sudo bash)." >&2
  exit 1
fi

distro_id=""
distro_id_like=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
  distro_id="${ID:-}"
  distro_id_like="${ID_LIKE:-}"
fi

# download_release_assets baixa pra $workdir todo asset da release cujo nome
# termina no sufixo passado (".rpm" ou ".deb"), usando a API de releases do
# GitHub.
download_release_assets() {
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

  local urls=()
  mapfile -t urls < <(printf '%s' "$release_json" \
    | grep -Eo "\"browser_download_url\": *\"[^\"]*${suffix}\"" \
    | sed -E 's/.*"(https:[^"]+)"/\1/')

  if [ "${#urls[@]}" -eq 0 ]; then
    echo "Erro: nenhum asset '*${suffix}' encontrado na release '$release_tag'." >&2
    echo "Confira se o workflow de release já rodou para essa tag:" >&2
    echo "  https://github.com/$REPO/releases" >&2
    exit 1
  fi

  for url in "${urls[@]}"; do
    echo "==> Baixando $(basename "$url")" >&2
    curl -fsSL "$url" -o "$workdir/$(basename "$url")"
  done
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

case "$distro_id $distro_id_like" in
  *opensuse*|*suse*)
    if ! command -v zypper >/dev/null 2>&1; then
      echo "Erro: 'zypper' não encontrado — isso não parece ser openSUSE." >&2
      exit 1
    fi

    download_release_assets '\.x86_64\.rpm'

    echo "==> Instalando via zypper"
    echo "Aviso: o RPM desta release ainda não é assinado (sem chave GPG"
    echo "configurada), então a instalação usa --allow-unsigned-rpm."
    zypper --non-interactive install -y --allow-unsigned-rpm "$workdir"/*.rpm
    ;;
  *fedora*)
    if ! command -v dnf >/dev/null 2>&1; then
      echo "Erro: 'dnf' não encontrado — isso não parece ser Fedora." >&2
      exit 1
    fi

    download_release_assets '\.x86_64\.rpm'

    echo "==> Instalando via dnf"
    echo "Aviso: o RPM desta release ainda não é assinado (sem chave GPG"
    echo "configurada), então a instalação usa --nogpgcheck."
    dnf install -y --nogpgcheck "$workdir"/*.rpm
    ;;
  *debian*|*ubuntu*)
    if ! command -v apt-get >/dev/null 2>&1; then
      echo "Erro: 'apt-get' não encontrado — isso não parece ser Debian/Ubuntu." >&2
      exit 1
    fi

    download_release_assets '\.deb'

    echo "==> Instalando via apt"
    apt-get update
    # apt (não dpkg -i) resolve as dependências do .deb a partir dos
    # repositórios já configurados.
    apt-get install -y "$workdir"/*.deb
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

cat <<'EOF'

Instalação concluída.
- App: /usr/bin/prosa (ou pelo atalho "Prosa" no menu)

Empacotamento ainda é considerado de teste — reporte problemas em
https://github.com/britors/Prosa/issues.
EOF
