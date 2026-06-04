# Pacote AUR — `prosa-bin`

Este diretório contém o modelo de `PKGBUILD` usado para publicar o Prosa na
[Arch User Repository](https://aur.archlinux.org/).

`PKGBUILD.in` traz dois marcadores que o workflow de release substitui:

- `__PKGVER__` — versão (derivada da tag `vX.Y.Z`);
- `__SHA256__` — soma SHA-256 do `.deb` publicado no Release.

## Publicação automática

O job `aur` do workflow `.github/workflows/release.yml` gera o `PKGBUILD`
final e o envia para a AUR. Para habilitá-lo, configure no repositório:

- **Variável** `ENABLE_AUR` = `true`
- **Variáveis** `AUR_USERNAME` e `AUR_EMAIL` (autor dos commits na AUR)
- **Segredo** `AUR_SSH_PRIVATE_KEY` — chave SSH cadastrada na conta da AUR

## Publicação manual

```bash
VERSION=0.1.0
DEB=prosa_${VERSION}_amd64.deb
SHA=$(curl -sL https://github.com/britors/Prosa/releases/download/v${VERSION}/${DEB} | sha256sum | cut -d' ' -f1)
sed -e "s/__PKGVER__/${VERSION}/g" -e "s/__SHA256__/${SHA}/g" PKGBUILD.in > PKGBUILD
makepkg --printsrcinfo > .SRCINFO
# git clone ssh://aur@aur.archlinux.org/prosa-bin.git && copie PKGBUILD/.SRCINFO e dê push
```
