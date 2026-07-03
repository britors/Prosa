// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

type Phase = 'work' | 'break'

/** Timer Pomodoro integrado na barra de status. */
export class FocusTimer {
  readonly el: HTMLButtonElement

  private workMinutes: number
  private breakMinutes: number
  private phase: Phase = 'work'
  private remainingSeconds: number
  private running = false
  private intervalId: ReturnType<typeof setInterval> | null = null

  constructor(initialWorkMinutes: number, initialBreakMinutes: number) {
    this.workMinutes = initialWorkMinutes
    this.breakMinutes = initialBreakMinutes
    this.remainingSeconds = this.workMinutes * 60

    this.el = document.createElement('button')
    this.el.className = 'focus-timer'
    this.el.type = 'button'
    this.el.onclick = () => this.toggle()
    this.render()
  }

  /** Atualiza as durações configuradas. Não interrompe uma contagem em andamento. */
  setDurations(workMinutes: number, breakMinutes: number): void {
    const wasIdleAtDefault =
      !this.running &&
      ((this.phase === 'work' && this.remainingSeconds === this.workMinutes * 60) ||
        (this.phase === 'break' && this.remainingSeconds === this.breakMinutes * 60))

    this.workMinutes = workMinutes
    this.breakMinutes = breakMinutes

    if (wasIdleAtDefault) {
      this.remainingSeconds = (this.phase === 'work' ? this.workMinutes : this.breakMinutes) * 60
    }
    this.render()
  }

  private toggle(): void {
    this.running = !this.running
    if (this.running) {
      this.intervalId = setInterval(() => this.tick(), 1000)
    } else if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.render()
  }

  private tick(): void {
    this.remainingSeconds -= 1
    if (this.remainingSeconds <= 0) {
      this.completePhase()
    }
    this.render()
  }

  private completePhase(): void {
    const finishedPhase = this.phase
    this.phase = finishedPhase === 'work' ? 'break' : 'work'
    this.remainingSeconds = (this.phase === 'work' ? this.workMinutes : this.breakMinutes) * 60
    this.notify(
      finishedPhase === 'work' ? 'Hora da pausa!' : 'De volta ao foco!'
    )
  }

  private notify(body: string): void {
    try {
      new Notification('Prosa', { body })
    } catch {
      // Notificações desktop podem não estar disponíveis — ignora silenciosamente.
    }
  }

  private render(): void {
    const minutes = Math.floor(this.remainingSeconds / 60)
    const seconds = this.remainingSeconds % 60
    const time = `${minutes}:${String(seconds).padStart(2, '0')}`
    const icon = this.phase === 'work' ? '<i class="ti ti-clock"></i>' : '<i class="ti ti-coffee"></i>'
    const playState = this.running ? '' : ' (pausado)'
    this.el.innerHTML = `${icon} ${time}`
    this.el.title = `Timer de Foco — ${this.phase === 'work' ? 'Trabalho' : 'Pausa'}${playState}. Clique para ${this.running ? 'pausar' : 'iniciar'}.`
  }
}
