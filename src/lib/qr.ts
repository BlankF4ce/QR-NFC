export type QrRecord = {
  id: string
  code: string
  name: string
  client_name: string
  destination_url: string
  active: boolean
  scan_count: number
  last_scan_at: string | null
  created_at: string
  updated_at: string
}

export type CsvPreview = {
  rows: Record<string, string>[]
  valid: number
  invalid: number
  duplicates: string[]
  invalidUrls: string[]
  errors: string[]
}

export const STORAGE_KEY = 'qr-manager-records-v1'
export const AUTH_KEY = 'qr-manager-auth-v1'

export function sanitizeCode(value: string): string {
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return cleaned.slice(0, 32) || 'QR001'
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
    } catch {
      return ''
    }
  }
}

export function validateUrl(value: string): boolean {
  return Boolean(normalizeUrl(value))
}

export function generateNextCode(existing: QrRecord[], preferred?: string): string {
  const draft = preferred ? sanitizeCode(preferred) : ''
  if (draft && !existing.some((item) => item.code.toUpperCase() === draft.toUpperCase())) {
    return draft
  }

  const numericValues = existing
    .map((item) => Number.parseInt(item.code.replace(/\D/g, ''), 10))
    .filter((item) => Number.isFinite(item))

  const nextNumber = Math.max(0, ...numericValues) + 1
  return `QR${String(nextNumber).padStart(3, '0')}`
}

export function safeFileName(value: string): string {
  return (value || 'qr-code')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function buildDynamicUrl(code: string): string {
  const base = typeof window !== 'undefined'
    ? new URL(import.meta.env.BASE_URL, window.location.href)
    : new URL('./', 'http://localhost:5173')
  base.hash = `/r/${encodeURIComponent(code)}`
  return base.toString()
}

export function buildCsv(records: QrRecord[]): string {
  const rows = records.map((record) => [
    record.code,
    record.name,
    record.client_name,
    record.destination_url,
    String(record.active),
    String(record.scan_count),
    record.last_scan_at ?? '',
    record.created_at,
  ])

  const header = ['code', 'name', 'client_name', 'destination_url', 'active', 'scan_count', 'last_scan_at', 'created_at']
  const lines = [header, ...rows].map((line) =>
    line
      .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
      .join(','),
  )

  return lines.join('\n')
}

export function parseCsvPreview(content: string): CsvPreview {
  const parsed = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)

  if (parsed.length < 2) {
    return { rows: [], valid: 0, invalid: 0, duplicates: [], invalidUrls: [], errors: ['CSV vazio ou sem cabeçalho.'] }
  }

  const rows = parsed.slice(1).map((line) => {
    const columns = line.split(',').map((cell) => cell.trim())

    return {
      code: columns[0] ?? '',
      name: columns[1] ?? '',
      client_name: columns[2] ?? '',
      destination_url: columns[3] ?? '',
    }
  })

  const errors: string[] = []
  const duplicates: string[] = []
  const invalidUrls: string[] = []
  const seen = new Set<string>()

  const valid = rows.filter((row) => {
    if (!row.code || !row.name || !row.client_name || !row.destination_url) {
      errors.push(`Linha com dados incompletos: ${JSON.stringify(row)}`)
      return false
    }

    const codeKey = row.code.trim().toUpperCase()
    if (seen.has(codeKey)) {
      duplicates.push(codeKey)
      errors.push(`Código duplicado: ${codeKey}`)
      return false
    }
    seen.add(codeKey)

    if (!validateUrl(row.destination_url)) {
      invalidUrls.push(row.code)
      errors.push(`URL inválida para ${row.code}`)
      return false
    }

    return true
  }).length

  return {
    rows,
    valid,
    invalid: rows.length - valid,
    duplicates,
    invalidUrls,
    errors,
  }
}
