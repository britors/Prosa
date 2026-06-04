# Pacote AUR — `prosa-bin`

`PKGBUILD` (e `.SRCINFO`) do pacote binário do Prosa para a
[Arch User Repository](https://aur.archlinux.org/). Instala o `.deb` oficial
publicado no GitHub Releases em `/opt/Prosa`, com symlink em `/usr/bin/prosa`,
atalho `.desktop` e ícone.

## Publicar / atualizar na AUR

1. Atualize `pkgver` e o `sha256sums` para a nova versão:
   ```bash
   VERSION=0.1.0
   DEB=prosa_${VERSION}_amd64.deb
   curl -sL -o "$DEB" \
     "https://github.com/britors/Prosa/releases/download/v${VERSION}/${DEB}"
   updpkgsums            # atualiza sha256sums no PKGBUILD
   makepkg --printsrcinfo > .SRCINFO
   ```
2. Teste localmente:
   ```bash
   makepkg -si
   ```
3. Envie para a AUR (repositório `ssh://aur@aur.archlinux.org/prosa-bin.git`):
   ```bash
   git add PKGBUILD .SRCINFO
   git commit -m "Atualiza para ${VERSION}"
   git push
   ```

> O `sha256sums` atual corresponde ao `.deb` da release **v0.1.0**.
