//! Sincronização/observação de arquivos: espelha `src/main/sync-watcher.ts`
//! (chokidar) do Electron — observa uma pasta escolhida pelo usuário
//! (destinada a serviços de sincronização externos como Dropbox/Drive,
//! *não* a pasta de workspace usada pelas wikilinks/bibliografia) e informa
//! quando um arquivo muda por fora do próprio app.
//!
//! Diferenças deliberadas do original:
//! - Eventos de remoção também são reportados (`SyncChangeKind::Removed`)
//!   — o Electron só tratava o evento `change` do chokidar, exclusão
//!   externa era simplesmente ignorada (confirmado por pesquisa no
//!   original, não uma omissão daqui).
//! - `SelfWriteGuard` (supressão de auto-notificação) usa `PathBuf`
//!   diretamente; comparação de igualdade de caminho fica por conta de
//!   quem chama (o lado GTK canonicaliza antes de comparar), em vez da
//!   comparação de string bruta do original.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, DebouncedEvent, Debouncer, FileIdMap};

/// Janela de estabilização antes de reportar uma mudança — equivalente ao
/// `awaitWriteFinish: { stabilityThreshold: 500 }` do chokidar original.
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(500);

/// Tempo que um caminho recém-salvo pelo próprio app fica "suprimido" caso
/// reapareça como evento externo — mesmo valor do original (3s).
pub const SELF_WRITE_TTL: Duration = Duration::from_secs(3);

/// Handle do observador ativo. Descartá-lo para a observação (mesmo
/// mecanismo do `if (watcher) void watcher.close()` do original antes de
/// trocar de pasta ou desativar a sincronização).
pub type Watcher = Debouncer<RecommendedWatcher, FileIdMap>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncChangeKind {
    Modified,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncEvent {
    pub path: PathBuf,
    pub kind: SyncChangeKind,
}

/// Ignora arquivos ocultos (qualquer componente do caminho começando com
/// `.` — inclui a própria pasta `.backups/` do histórico de versões),
/// mesmo filtro `ignored: /(^|[/\\])\../ ` do chokidar original.
pub fn is_hidden(path: &Path) -> bool {
    path.components().any(|c| c.as_os_str().to_str().is_some_and(|s| s.starts_with('.')))
}

fn classify(kind: &EventKind) -> Option<SyncChangeKind> {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) => Some(SyncChangeKind::Modified),
        EventKind::Remove(_) => Some(SyncChangeKind::Removed),
        _ => None,
    }
}

/// Extrai os `SyncEvent`s relevantes de um lote já debounced — função pura,
/// separada da criação do watcher de verdade pra poder testar sem tocar o
/// sistema de arquivos.
fn events_from_batch(batch: &[DebouncedEvent]) -> Vec<SyncEvent> {
    let mut out = Vec::new();
    for event in batch {
        let Some(kind) = classify(&event.kind) else { continue };
        for path in &event.paths {
            if is_hidden(path) {
                continue;
            }
            out.push(SyncEvent { path: path.clone(), kind });
        }
    }
    out
}

/// Começa a observar `root` (recursivamente), enviando cada `SyncEvent`
/// relevante em `tx`. Erros do lado do notify (não do fs em si) são
/// descartados silenciosamente, igual ao original.
pub fn start_watching(root: &Path, tx: Sender<SyncEvent>) -> notify_debouncer_full::notify::Result<Watcher> {
    let mut debouncer = new_debouncer(DEBOUNCE_WINDOW, None, move |result: DebounceEventResult| {
        if let Ok(batch) = result {
            for event in events_from_batch(&batch) {
                let _ = tx.send(event);
            }
        }
    })?;
    debouncer.watcher().watch(root, RecursiveMode::Recursive)?;
    debouncer.cache().add_root(root, RecursiveMode::Recursive);
    Ok(debouncer)
}

/// Deduplica eventos: um save do próprio app não deve reaparecer como
/// "mudança externa" só porque o watcher também vê o `fs::write`.
#[derive(Default)]
pub struct SelfWriteGuard {
    marked: HashMap<PathBuf, Instant>,
}

impl SelfWriteGuard {
    pub fn mark(&mut self, path: &Path) {
        self.marked.insert(path.to_path_buf(), Instant::now());
    }

    /// `true` se `path` foi marcado há menos de `SELF_WRITE_TTL` — consome a
    /// marca nesse caso, pra não engolir a *próxima* mudança externa real.
    pub fn should_ignore(&mut self, path: &Path) -> bool {
        self.marked.retain(|_, at| at.elapsed() < SELF_WRITE_TTL);
        self.marked.remove(path).is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{CreateKind, ModifyKind, RemoveKind};
    use notify_debouncer_full::notify::Event;

    fn debounced(kind: EventKind, paths: &[&str]) -> DebouncedEvent {
        let event = Event { kind, paths: paths.iter().map(PathBuf::from).collect(), attrs: Default::default() };
        DebouncedEvent::new(event, Instant::now())
    }

    #[test]
    fn is_hidden_detects_any_dot_component() {
        assert!(is_hidden(Path::new("/a/.backups/x.prosa")));
        assert!(is_hidden(Path::new(".git/config")));
        assert!(!is_hidden(Path::new("/a/b/documento.prosa")));
    }

    #[test]
    fn events_from_batch_classifies_and_filters_hidden() {
        let batch = vec![
            debounced(EventKind::Modify(ModifyKind::Any), &["/ws/doc.prosa"]),
            debounced(EventKind::Create(CreateKind::File), &["/ws/novo.prosa"]),
            debounced(EventKind::Remove(RemoveKind::File), &["/ws/apagado.prosa"]),
            debounced(EventKind::Modify(ModifyKind::Any), &["/ws/.backups/doc.prosa.bak"]),
            debounced(EventKind::Access(notify_debouncer_full::notify::event::AccessKind::Any), &["/ws/doc.prosa"]),
        ];

        let events = events_from_batch(&batch);

        assert_eq!(
            events,
            vec![
                SyncEvent { path: PathBuf::from("/ws/doc.prosa"), kind: SyncChangeKind::Modified },
                SyncEvent { path: PathBuf::from("/ws/novo.prosa"), kind: SyncChangeKind::Modified },
                SyncEvent { path: PathBuf::from("/ws/apagado.prosa"), kind: SyncChangeKind::Removed },
            ],
            "acesso é ignorado, arquivo oculto (.backups) é filtrado, criação conta como modificação"
        );
    }

    #[test]
    fn self_write_guard_ignores_once_within_ttl() {
        let mut guard = SelfWriteGuard::default();
        let path = PathBuf::from("/ws/doc.prosa");

        assert!(!guard.should_ignore(&path), "sem marcação, não deve ignorar");

        guard.mark(&path);
        assert!(guard.should_ignore(&path), "logo após marcar, deve ignorar");
        assert!(!guard.should_ignore(&path), "a marca é consumida — a próxima mudança já não é mais ignorada");
    }

    #[test]
    fn self_write_guard_does_not_confuse_different_paths() {
        let mut guard = SelfWriteGuard::default();
        guard.mark(&PathBuf::from("/ws/a.prosa"));
        assert!(!guard.should_ignore(&PathBuf::from("/ws/b.prosa")));
    }

    /// Teste de integração de verdade (não só as funções puras acima):
    /// observa uma pasta temporária real, escreve um arquivo nela, e
    /// confirma que um `SyncEvent` chega no canal — cobre a parte que as
    /// funções puras não alcançam (o `notify`/`inotify` real, o debounce de
    /// verdade). Janela de espera generosa (bem acima de `DEBOUNCE_WINDOW`)
    /// porque tempo de estabilização de fs é inerentemente não-determinístico.
    #[test]
    fn start_watching_reports_a_real_external_change() {
        let dir = std::env::temp_dir().join(format!("prosa-sync-watcher-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = start_watching(&dir, tx).expect("deve conseguir observar uma pasta real");

        std::thread::sleep(Duration::from_millis(200));
        std::fs::write(dir.join("externo.prosa"), "conteúdo").unwrap();

        let event = rx.recv_timeout(Duration::from_secs(5)).expect("deve receber um SyncEvent pra escrita externa");
        assert_eq!(event.path, dir.join("externo.prosa"));
        assert_eq!(event.kind, SyncChangeKind::Modified, "criação de arquivo conta como modificação");

        std::fs::remove_dir_all(&dir).ok();
    }
}
