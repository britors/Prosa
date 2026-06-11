// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Importação "melhor esforço" do formato binário legado do Word 97-2003
 * (.doc). Esses arquivos são contêineres OLE2/CFB cujo texto fica no fluxo
 * "WordDocument". Aqui fazemos a leitura mínima do contêiner e extraímos o
 * texto; a formatação rica NÃO é preservada (o .doc é um formato obsoleto).
 *
 * Para edição com fidelidade, recomende ao usuário salvar como .docx/.odt.
 */

/** Assinatura de um arquivo composto OLE2 (CFB). */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** Verifica se o buffer começa com a assinatura OLE2. */
export function isDocFile(buffer: Buffer): boolean {
  if (buffer.length < 8) return false
  return OLE_SIGNATURE.every((byte, index) => buffer[index] === byte)
}

/** Buffer cuja origem de memória é indiferente (subarray/concat). */
type Bytes = Buffer<ArrayBufferLike>

/** Entrada de diretório do contêiner CFB. */
interface DirEntry {
  name: string
  type: number
  startSector: number
  size: number
}

/** Leitor mínimo de contêiner composto (CFB) para extrair fluxos. */
class CompoundFile {
  private readonly buf: Buffer
  private readonly sectorSize: number
  private readonly miniSectorSize: number
  private readonly miniCutoff: number
  private readonly fat: number[] = []
  private readonly miniFat: number[] = []
  private readonly dir: DirEntry[] = []
  private miniStream: Bytes = Buffer.alloc(0)

  constructor(buffer: Buffer) {
    this.buf = buffer
    this.sectorSize = 1 << buffer.readUInt16LE(0x1e)
    this.miniSectorSize = 1 << buffer.readUInt16LE(0x20)
    this.miniCutoff = buffer.readUInt32LE(0x38)
    this.readFat()
    this.readMiniFat()
    this.readDirectory()
    this.readMiniStream()
  }

  /** Converte um índice de setor em deslocamento absoluto no arquivo. */
  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize
  }

  /** Lê a FAT principal a partir do array DIFAT. */
  private readFat(): void {
    const difat: number[] = []
    for (let i = 0; i < 109; i += 1) {
      difat.push(this.buf.readInt32LE(0x4c + i * 4))
    }
    // Setores DIFAT adicionais encadeados.
    let sector = this.buf.readInt32LE(0x44)
    const numDifat = this.buf.readUInt32LE(0x48)
    for (let n = 0; n < numDifat && sector >= 0; n += 1) {
      const base = this.sectorOffset(sector)
      const entries = this.sectorSize / 4
      for (let i = 0; i < entries - 1; i += 1) {
        difat.push(this.buf.readInt32LE(base + i * 4))
      }
      sector = this.buf.readInt32LE(base + (entries - 1) * 4)
    }
    for (const fatSector of difat) {
      if (fatSector < 0) continue
      const base = this.sectorOffset(fatSector)
      for (let i = 0; i < this.sectorSize / 4; i += 1) {
        this.fat.push(this.buf.readInt32LE(base + i * 4))
      }
    }
  }

  /** Lê a mini-FAT (para fluxos pequenos). */
  private readMiniFat(): void {
    let sector = this.buf.readInt32LE(0x3c)
    const count = this.buf.readUInt32LE(0x40)
    for (let n = 0; n < count && sector >= 0; n += 1) {
      const base = this.sectorOffset(sector)
      for (let i = 0; i < this.sectorSize / 4; i += 1) {
        this.miniFat.push(this.buf.readInt32LE(base + i * 4))
      }
      sector = this.fat[sector] ?? -2
    }
  }

  /** Concatena os setores de uma cadeia da FAT principal. */
  private readChain(start: number, size?: number): Bytes {
    const chunks: Bytes[] = []
    let sector = start
    let guard = 0
    while (sector >= 0 && guard < this.fat.length + 1) {
      const base = this.sectorOffset(sector)
      chunks.push(this.buf.subarray(base, base + this.sectorSize))
      sector = this.fat[sector] ?? -2
      guard += 1
    }
    const data = Buffer.concat(chunks)
    return size !== undefined ? data.subarray(0, size) : data
  }

  /** Lê as entradas do diretório do contêiner. */
  private readDirectory(): void {
    const dirData = this.readChain(this.buf.readInt32LE(0x30))
    for (let offset = 0; offset + 128 <= dirData.length; offset += 128) {
      const nameLen = dirData.readUInt16LE(offset + 64)
      if (nameLen <= 0) continue
      const name = dirData
        .subarray(offset, offset + Math.max(0, nameLen - 2))
        .toString('utf16le')
      const type = dirData.readUInt8(offset + 66)
      const startSector = dirData.readInt32LE(offset + 116)
      const size = dirData.readUInt32LE(offset + 120)
      this.dir.push({ name, type, startSector, size })
    }
  }

  /** Lê o mini-stream (armazenado no Root Entry). */
  private readMiniStream(): void {
    const root = this.dir.find((e) => e.type === 5)
    if (root && root.startSector >= 0) {
      this.miniStream = this.readChain(root.startSector, root.size)
    }
  }

  /** Concatena os mini-setores de uma cadeia da mini-FAT. */
  private readMiniChain(start: number, size: number): Bytes {
    const chunks: Bytes[] = []
    let sector = start
    let guard = 0
    while (sector >= 0 && guard < this.miniFat.length + 1) {
      const base = sector * this.miniSectorSize
      chunks.push(this.miniStream.subarray(base, base + this.miniSectorSize))
      sector = this.miniFat[sector] ?? -2
      guard += 1
    }
    return Buffer.concat(chunks).subarray(0, size)
  }

  /** Lê o conteúdo de um fluxo nomeado, ou null se inexistente. */
  readStream(name: string): Bytes | null {
    const entry = this.dir.find((e) => e.type === 2 && e.name === name)
    if (!entry) return null
    if (entry.size < this.miniCutoff) {
      return this.readMiniChain(entry.startSector, entry.size)
    }
    return this.readChain(entry.startSector, entry.size)
  }
}

/** Escapa texto para HTML seguro. */
function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Conta bytes nulos em posições ímpares (indício de UTF-16LE). */
function countZeros(data: Buffer): number {
  let zeros = 0
  for (let i = 1; i < data.length; i += 2) {
    if (data[i] === 0) zeros += 1
  }
  return zeros
}

/**
 * Decide se um trecho está em UTF-16LE (predominância de bytes nulos em
 * posições ímpares) ou em CP1252 de 8 bits, e decodifica para string.
 */
function decodeWordText(data: Buffer): string {
  const sampleLen = Math.min(data.length, 4096)
  const zeros = countZeros(data.subarray(0, sampleLen))
  const looksUtf16 = sampleLen > 0 && zeros / (sampleLen / 2) > 0.6
  return looksUtf16 ? data.toString('utf16le') : data.toString('latin1')
}

/** Marcadores que separam parágrafos no texto bruto do Word. */
const PARAGRAPH_SEPARATORS = /[\r\n\u0007\u000B\u000C]/
/** Caracteres de controle remanescentes a remover de cada parágrafo. */
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F]/g

/**
 * Converte texto bruto extraído do .doc em HTML, quebrando parágrafos nos
 * marcadores de fim de parágrafo do Word e descartando caracteres de
 * controle remanescentes.
 */
function textToHtml(raw: string): string {
  const paragraphs = raw
    .split(PARAGRAPH_SEPARATORS)
    .map((p) => p.replace(CONTROL_CHARS, '').trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length === 0) return '<p></p>'
  return paragraphs.map((p) => `<p>${htmlEscape(p)}</p>`).join('\n')
}

/**
 * Importa um arquivo .doc (Word 97-2003) extraindo o texto do fluxo
 * WordDocument. A formatação não é preservada. Lança erro amigável se o
 * arquivo não puder ser interpretado.
 */
export function importDoc(buffer: Buffer): string {
  if (!isDocFile(buffer)) {
    throw new Error(
      'Arquivo .doc não reconhecido (assinatura OLE2 ausente). ' +
        'Tente reabrir e salvar como .docx ou .odt.'
    )
  }
  try {
    const cfb = new CompoundFile(buffer)
    const stream = cfb.readStream('WordDocument')
    if (!stream || stream.length < 32) {
      throw new Error('Fluxo WordDocument ausente ou vazio.')
    }
    // FIB (File Information Block): fcMin e ccpText localizam o texto principal.
    const fcMin = stream.readUInt32LE(0x18)
    const ccpText = stream.readUInt32LE(0x4c)
    let region: Buffer
    if (ccpText > 0 && fcMin + ccpText <= stream.length) {
      // O texto pode estar em 8 bits ou 16 bits; escolhemos pela densidade
      // de bytes nulos da janela de 16 bits.
      const as8 = stream.subarray(fcMin, fcMin + ccpText)
      const as16 = stream.subarray(fcMin, Math.min(stream.length, fcMin + ccpText * 2))
      region = countZeros(as16) > as16.length * 0.3 ? as16 : as8
    } else {
      region = stream.subarray(Math.min(0x800, stream.length))
    }
    const html = textToHtml(decodeWordText(region))
    if (html === '<p></p>') {
      throw new Error('Não foi possível extrair texto legível do arquivo.')
    }
    return html
  } catch (error) {
    throw new Error(
      `Falha ao importar .doc: ${(error as Error).message}. ` +
        'O formato .doc (Word 97-2003) tem suporte limitado — ' +
        'prefira .docx ou .odt.'
    )
  }
}
