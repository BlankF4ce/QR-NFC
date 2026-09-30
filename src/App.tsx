import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom'
import JSZip from 'jszip'
import QRCode from 'qrcode'
import {
  AUTH_KEY,
  STORAGE_KEY,
  buildCsv,
  buildDynamicUrl,
  generateNextCode,
  parseCsvPreview,
  safeFileName,
  sanitizeCode,
  validateUrl,
  type QrRecord,
} from './lib/qr'
import { isSupabaseConfigured, isSupabaseInviteCallback, supabase } from './lib/supabase'
import {
  deleteQrRecord,
  insertQrRecords,
  listQrRecords,
  resolvePublicQrCode,
  updateQrRecord,
} from './lib/qrRepository'

type ToastKind = 'success' | 'error' | 'info'

type ToastState = {
  kind: ToastKind
  message: string
} | null

type AuthState = {
  isAuthenticated: boolean
  email: string | null
}

type BatchRow = {
  code: string
  name: string
  client_name: string
  destination_url: string
}

type CsvValidation = {
  rows: BatchRow[]
  valid: number
  invalid: number
  duplicates: string[]
  invalidUrls: string[]
  errors: string[]
}

const DEMO_EMAIL = 'admin@qrmanager.local'
const DEMO_PASSWORD = 'admin123'

function getDemoData(): QrRecord[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'demo-1',
      code: 'QR001',
      name: 'Restaurante Sabor & Cia',
      client_name: 'Restaurante Sabor & Cia',
      destination_url: 'https://maps.google.com/?q=restaurante+sabor',
      active: true,
      scan_count: 24,
      last_scan_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'demo-2',
      code: 'QR002',
      name: 'Loja B',
      client_name: 'Loja B',
      destination_url: 'https://www.instagram.com/',
      active: false,
      scan_count: 7,
      last_scan_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'demo-3',
      code: 'QR003',
      name: 'Escritório',
      client_name: 'Cliente Alpha',
      destination_url: 'https://www.linkedin.com/',
      active: true,
      scan_count: 13,
      last_scan_at: now,
      created_at: now,
      updated_at: now,
    },
  ]
}

function loadRecords(): QrRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as QrRecord[]
      }
    }
  } catch (error) {
    console.warn('Não foi possível carregar os QR Codes salvos.', error)
  }

  const seeded = getDemoData()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AuthState
      return parsed
    }
  } catch (error) {
    console.warn('Não foi possível carregar autenticação local.', error)
  }

  return { isAuthenticated: false, email: null }
}

function formatDate(value: string | null): string {
  if (!value) return 'Nunca'

  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function downloadBlob(blob: Blob, name: string): void {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function App() {
  const [authState, setAuthState] = useState<AuthState>(() =>
    supabase ? { isAuthenticated: false, email: null } : loadAuth(),
  )
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [records, setRecords] = useState<QrRecord[]>(() => (supabase ? [] : loadRecords()))
  const [recordsLoading, setRecordsLoading] = useState(Boolean(supabase))
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    if (!supabase) return

    let mounted = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (!session) {
        setRecords([])
        setRecordsLoading(false)
      } else {
        setRecordsLoading(true)
      }
      setAuthState({ isAuthenticated: Boolean(session), email: session?.user.email ?? null })
      setAuthLoading(false)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setToast({ kind: 'error', message: 'Não foi possível validar a sessão do Supabase.' })
      }
      if (!data.session) {
        setRecords([])
        setRecordsLoading(false)
      } else {
        setRecordsLoading(true)
      }
      setAuthState({ isAuthenticated: Boolean(data.session), email: data.session?.user.email ?? null })
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (supabase) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  useEffect(() => {
    if (supabase) return
    localStorage.setItem(AUTH_KEY, JSON.stringify(authState))
  }, [authState])

  useEffect(() => {
    if (!supabase) return
    if (!authState.isAuthenticated) return

    let mounted = true
    void listQrRecords()
      .then((nextRecords) => {
        if (mounted) setRecords(nextRecords)
      })
      .catch(() => {
        if (mounted) {
          setToast({ kind: 'error', message: 'Não foi possível carregar os QR Codes do Supabase.' })
        }
      })
      .finally(() => {
        if (mounted) setRecordsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [authState.isAuthenticated])

  useEffect(() => {
    if (!toast) return

    const timeout = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const totalScans = records.reduce((sum, item) => sum + item.scan_count, 0)

  const stats = useMemo(() => {
    return {
      total: records.length,
      active: records.filter((item) => item.active).length,
      inactive: records.filter((item) => !item.active).length,
      scans: totalScans,
    }
  }, [records, totalScans])

  const showToast = (message: string, kind: ToastKind = 'success') => {
    setToast({ message, kind })
  }

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const handleLogin = async (email: string, password: string) => {
    try {
      if (supabase && isSupabaseConfigured) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          throw error
        }
      } else {
        const normalizedEmail = email.trim().toLowerCase()
        if (normalizedEmail !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
          throw new Error('Credenciais inválidas.')
        }
      }

      setAuthState({ isAuthenticated: true, email: email.trim() })
      showToast('Login realizado com sucesso.', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível realizar o login.'
      showToast(message, 'error')
      throw error
    }
  }

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut()
    }

    setAuthState({ isAuthenticated: false, email: null })
    showToast('Logout realizado com sucesso.', 'info')
  }

  const createQr = async (payload: { code?: string; name: string; client_name: string; destination_url: string }) => {
    const name = payload.name.trim()
    const clientName = payload.client_name.trim()
    const destinationUrl = payload.destination_url.trim()

    if (!name || !clientName || !destinationUrl) {
      showToast('Nome, cliente e URL de destino são obrigatórios.', 'error')
      return false
    }

    if (!validateUrl(destinationUrl)) {
      showToast('URL inválida. Informe uma URL válida.', 'error')
      return false
    }

    const sanitizedCode = payload.code ? sanitizeCode(payload.code) : generateNextCode(records)
    if (records.some((item) => item.code.toUpperCase() === sanitizedCode.toUpperCase())) {
      showToast(`O código ${sanitizedCode} já está em uso.`, 'error')
      return false
    }

    const now = new Date().toISOString()
    const nextRecord: QrRecord = {
      id: crypto.randomUUID(),
      code: sanitizedCode,
      name,
      client_name: clientName,
      destination_url: destinationUrl,
      active: true,
      scan_count: 0,
      last_scan_at: null,
      created_at: now,
      updated_at: now,
    }

    try {
      const [savedRecord] = supabase ? await insertQrRecords([nextRecord]) : [nextRecord]
      setRecords((current) => [savedRecord, ...current])
      showToast(`QR ${sanitizedCode} criado com sucesso.`, 'success')
      return true
    } catch {
      showToast('Não foi possível salvar o QR Code. Verifique sua conexão e permissões.', 'error')
      return false
    }
  }

  const updateQr = async (id: string, updates: Partial<QrRecord>): Promise<QrRecord | null> => {
    const currentRecord = records.find((record) => record.id === id)
    if (!currentRecord) return null

    try {
      const nextRecord = supabase
        ? await updateQrRecord(id, updates)
        : { ...currentRecord, ...updates, updated_at: new Date().toISOString() }
      setRecords((current) => current.map((record) => (record.id === id ? nextRecord : record)))
      return nextRecord
    } catch {
      showToast('Não foi possível atualizar o QR Code. Verifique sua conexão e permissões.', 'error')
      return null
    }
  }

  const deleteQr = async (id: string) => {
    const record = records.find((item) => item.id === id)
    if (!record) return

    const accepted = window.confirm(`Tem certeza que deseja excluir o QR Code ${record.code}?`)
    if (!accepted) return

    try {
      if (supabase) await deleteQrRecord(id)
      setRecords((current) => current.filter((item) => item.id !== id))
      showToast(`QR ${record.code} excluído com sucesso.`, 'success')
    } catch {
      showToast('Não foi possível excluir o QR Code. Verifique sua conexão e permissões.', 'error')
    }
  }

  const toggleStatus = (id: string) => {
    const target = records.find((item) => item.id === id)
    if (!target) return

    void updateQr(id, { active: !target.active }).then((updated) => {
      if (updated) showToast(`QR ${target.code} ${target.active ? 'desativado' : 'ativado'} com sucesso.`, 'success')
    })
  }

  const toggleSelectedId = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  const toggleSelectAllVisible = () => {
    const visibleIds = filterRecords.map((record) => record.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))

    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }

    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  const clearSelectedIds = () => {
    setSelectedIds([])
  }

  const selectedRecords = records.filter((record) => selectedIds.includes(record.id))

  const bulkDeleteSelected = async () => {
    if (selectedRecords.length === 0) return

    const names = selectedRecords.map((record) => record.code).join(', ')
    const accepted = window.confirm(`Deseja excluir os QR Codes selecionados: ${names}?`)
    if (!accepted) return

    try {
      if (supabase) {
        await Promise.all(selectedRecords.map((record) => deleteQrRecord(record.id)))
      }

      setRecords((current) => current.filter((record) => !selectedIds.includes(record.id)))
      setSelectedIds([])
      showToast(`${selectedRecords.length} QR Codes excluídos com sucesso.`, 'success')
    } catch {
      showToast('Não foi possível excluir os QR Codes selecionados.', 'error')
    }
  }

  const downloadSelectedPngZip = async () => {
    if (selectedRecords.length === 0) return

    const zip = new JSZip()

    for (const record of selectedRecords) {
      const dataUrl = await QRCode.toDataURL(buildDynamicUrl(record.code), {
        errorCorrectionLevel: 'M',
        width: 1200,
        margin: 1,
        type: 'image/png',
      })
      const base64 = dataUrl.split(',')[1]
      zip.file(`${safeFileName(record.code)}-${safeFileName(record.name)}.png`, base64, { base64: true })
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(blob, `qr-codes-selecionados-${selectedRecords.length}.zip`)
    showToast('ZIP dos QR Codes selecionados baixado com sucesso.', 'success')
  }

  const handleCsvUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      const validation = parseCsvPreview(content)
      if (validation.rows.length === 0) {
        showToast('CSV inválido. Verifique o conteúdo do arquivo.', 'error')
        return
      }

      const parsedRows: BatchRow[] = validation.rows.map((row) => ({
        code: row.code ?? '',
        name: row.name ?? '',
        client_name: row.client_name ?? '',
        destination_url: row.destination_url ?? '',
      }))

      setCsvPreview({
        rows: parsedRows,
        valid: validation.valid,
        invalid: validation.invalid,
        duplicates: validation.duplicates,
        invalidUrls: validation.invalidUrls,
        errors: validation.errors,
      })
    }
    reader.readAsText(file)
  }

  const [batchRows, setBatchRows] = useState<BatchRow[]>([
    { code: '', name: '', client_name: '', destination_url: '' },
  ])
  const [csvPreview, setCsvPreview] = useState<CsvValidation | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selectedQr, setSelectedQr] = useState<QrRecord | null>(null)

  const handleBatchManualAdd = () => {
    if (batchRows.length >= 100) {
      showToast('O lote máximo é de 100 QR Codes.', 'error')
      return
    }

    setBatchRows((current) => [...current, { code: '', name: '', client_name: '', destination_url: '' }])
  }

  const updateBatchRow = (index: number, field: keyof BatchRow, value: string) => {
    setBatchRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    )
  }

  const createBatchFromRows = async () => {
    const rows = batchRows.filter((row) => row.name || row.client_name || row.destination_url || row.code)

    if (rows.length === 0) {
      showToast('Adicione ao menos uma linha antes de gerar o lote.', 'error')
      return
    }

    if (rows.length > 100) {
      showToast('O lote excedeu o limite de 100 registros.', 'error')
      return
    }

    const errors: string[] = []
    const normalizedRows: QrRecord[] = []
    const usedCodes = new Set(records.map((item) => item.code.toUpperCase()))

    rows.forEach((row) => {
      const code = row.code.trim()
        ? sanitizeCode(row.code)
        : generateNextCode([...records, ...normalizedRows])
      const name = row.name.trim()
      const clientName = row.client_name.trim()
      const destinationUrl = row.destination_url.trim()

      if (!name || !clientName || !destinationUrl) {
        errors.push(`Registro incompleto para ${row.code || 'código vazio'}.`)
        return
      }

      if (!validateUrl(destinationUrl)) {
        errors.push(`URL inválida para ${code}.`)
        return
      }

      if (usedCodes.has(code.toUpperCase())) {
        errors.push(`Código duplicado: ${code}.`)
        return
      }

      const now = new Date().toISOString()
      normalizedRows.push({
        id: crypto.randomUUID(),
        code,
        name,
        client_name: clientName,
        destination_url: destinationUrl,
        active: true,
        scan_count: 0,
        last_scan_at: null,
        created_at: now,
        updated_at: now,
      })
      usedCodes.add(code.toUpperCase())
    })

    if (errors.length > 0) {
      showToast(errors[0], 'error')
      return
    }

    try {
      const savedRecords = supabase ? await insertQrRecords(normalizedRows) : normalizedRows
      setRecords((current) => [...savedRecords, ...current])
      setBatchRows([{ code: '', name: '', client_name: '', destination_url: '' }])
      showToast(`${savedRecords.length} QR Codes criados com sucesso.`, 'success')
    } catch {
      showToast('Não foi possível salvar o lote. Verifique sua conexão e permissões.', 'error')
    }
  }

  const createStockBatch = async () => {
    const accepted = window.confirm(
      'Criar 100 QR Codes de estoque? Eles ficarão inativos até você configurar cada destino.',
    )
    if (!accepted) return

    const stockRecords: QrRecord[] = []
    const now = new Date().toISOString()

    for (let index = 0; index < 100; index += 1) {
      const code = generateNextCode([...records, ...stockRecords])
      stockRecords.push({
        id: crypto.randomUUID(),
        code,
        name: `Estoque ${code}`,
        client_name: 'Disponível',
        destination_url: 'https://example.com',
        active: false,
        scan_count: 0,
        last_scan_at: null,
        created_at: now,
        updated_at: now,
      })
    }

    try {
      const savedRecords = supabase ? await insertQrRecords(stockRecords) : stockRecords
      setRecords((current) => [...savedRecords, ...current])
      showToast('100 QR Codes de estoque criados como inativos.', 'success')
    } catch {
      showToast('Não foi possível criar o estoque de QR Codes. Verifique sua conexão e permissões.', 'error')
    }
  }

  const createBatchFromCsv = async () => {
    if (!csvPreview || csvPreview.valid === 0) {
      showToast('Valide o arquivo CSV antes de gerar os QR Codes.', 'error')
      return
    }

    const usedCodes = new Set(records.map((item) => item.code.toUpperCase()))
    const nextRows: QrRecord[] = []

    csvPreview.rows.forEach((row) => {
      const code = row.code.trim()
        ? sanitizeCode(row.code)
        : generateNextCode([...records, ...nextRows])
      const name = row.name.trim()
      const clientName = row.client_name.trim()
      const destinationUrl = row.destination_url.trim()

      if (!usedCodes.has(code.toUpperCase())) {
        const now = new Date().toISOString()
        nextRows.push({
          id: crypto.randomUUID(),
          code,
          name,
          client_name: clientName,
          destination_url: destinationUrl,
          active: true,
          scan_count: 0,
          last_scan_at: null,
          created_at: now,
          updated_at: now,
        })
        usedCodes.add(code.toUpperCase())
      }
    })

    try {
      const savedRecords = supabase ? await insertQrRecords(nextRows) : nextRows
      setRecords((current) => [...savedRecords, ...current])
      setCsvPreview(null)
      showToast(`${savedRecords.length} QR Codes importados com sucesso.`, 'success')
    } catch {
      showToast('Não foi possível importar o lote. Verifique sua conexão e permissões.', 'error')
    }
  }

  const filterRecords = useMemo(() => {
    const term = search.trim().toLowerCase()

    return records.filter((record) => {
      const matchesFilter =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? record.active
            : !record.active

      const matchesSearch =
        !term ||
        [record.code, record.name, record.client_name, record.destination_url]
          .join(' ')
          .toLowerCase()
          .includes(term)

      return matchesFilter && matchesSearch
    })
  }, [records, search, statusFilter])

  const downloadQrPng = async (record: QrRecord) => {
    const targetUrl = buildDynamicUrl(record.code)
    const dataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'M',
      width: 1200,
      margin: 1,
      type: 'image/png',
    })

    const blob = await fetch(dataUrl).then((response) => response.blob())
    downloadBlob(blob, `${safeFileName(record.code)}-${safeFileName(record.name)}.png`)
  }

  const exportAllCsv = () => {
    const csv = buildCsv(records)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    downloadBlob(blob, 'qr-codes-export.csv')
    showToast('CSV exportado com sucesso.', 'success')
  }

  const downloadZip = async () => {
    if (records.length === 0) {
      showToast('Nenhum QR Code disponível para download em lote.', 'error')
      return
    }

    const zip = new JSZip()

    for (const record of records) {
      const dataUrl = await QRCode.toDataURL(buildDynamicUrl(record.code), {
        errorCorrectionLevel: 'M',
        width: 1200,
        margin: 1,
        type: 'image/png',
      })
      const base64 = dataUrl.split(',')[1]
      zip.file(`${safeFileName(record.code)}-${safeFileName(record.name)}.png`, base64, { base64: true })
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(blob, 'qr-codes-batch.zip')
    showToast('ZIP gerado com sucesso.', 'success')
  }

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total de QR Codes" value={stats.total} accent="blue" />
        <StatCard label="Ativos" value={stats.active} accent="green" />
        <StatCard label="Inativos" value={stats.inactive} accent="slate" />
        <StatCard label="Total de scans" value={stats.scans} accent="violet" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-800">QR Codes recentes</h2>
          <NavLink to="/qr-codes" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Ver todos
          </NavLink>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-3 pr-4 font-medium">Código</th>
                <th className="py-3 pr-4 font-medium">Nome</th>
                <th className="py-3 pr-4 font-medium">Cliente</th>
                <th className="py-3 pr-4 font-medium">Destino</th>
                <th className="py-3 pr-4 font-medium">Scans</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 pr-4 font-medium">Criado</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 6).map((record) => (
                <tr key={record.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pr-4 font-semibold text-slate-800">{record.code}</td>
                  <td className="py-3 pr-4">{record.name}</td>
                  <td className="py-3 pr-4">{record.client_name}</td>
                  <td className="py-3 pr-4 text-slate-500">{record.destination_url}</td>
                  <td className="py-3 pr-4">{record.scan_count}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        record.active
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {record.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-500">{formatDate(record.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  const renderQrCodes = () => {
    const visibleActiveIds = filterRecords.filter((record) => record.active).map((record) => record.id)
    const allVisibleSelected = filterRecords.length > 0 && filterRecords.every((record) => selectedIds.includes(record.id))
    const allVisibleActiveSelected =
      visibleActiveIds.length > 0 && visibleActiveIds.every((id) => selectedIds.includes(id))

    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-soft">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 md:flex-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar código, nome, cliente ou URL"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:bg-white md:max-w-md"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-500 focus:bg-white"
              >
                <option value="all">Todos</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-xl border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700">
                {selectedIds.length} selecionado{selectedIds.length === 1 ? '' : 's'}
              </div>
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                {allVisibleSelected ? 'Desmarcar visíveis' : 'Selecionar visíveis'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const activeVisibleIds = filterRecords.filter((record) => record.active).map((record) => record.id)
                  const shouldSelectAllActive = activeVisibleIds.length > 0 && !activeVisibleIds.every((id) => selectedIds.includes(id))

                  if (shouldSelectAllActive) {
                    setSelectedIds((current) => Array.from(new Set([...current, ...activeVisibleIds])))
                    return
                  }

                  setSelectedIds((current) => current.filter((id) => !activeVisibleIds.includes(id)))
                }}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                {allVisibleActiveSelected ? 'Desmarcar ativos' : 'Selecionar ativos'}
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                disabled={selectedIds.length === 0}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Desmarcar tudo
              </button>
              <button
                type="button"
                onClick={() => void downloadSelectedPngZip()}
                disabled={selectedIds.length === 0}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Baixar selecionados
              </button>
              <button
                type="button"
                onClick={() => void bulkDeleteSelected()}
                disabled={selectedIds.length === 0}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Excluir selecionados
              </button>
              <button
                type="button"
                onClick={exportAllCsv}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Exportar CSV
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-3 font-medium">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label="Selecionar todos os QR Codes visíveis"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Destino</th>
                  <th className="px-4 py-3 font-medium">Scans</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filterRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      Nenhum QR Code encontrado.
                    </td>
                  </tr>
                ) : (
                  filterRecords.map((record) => (
                    <tr key={record.id} className="border-t border-slate-100 align-top transition hover:bg-slate-50/80">
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(record.id)}
                          onChange={() => toggleSelectedId(record.id)}
                          aria-label={`Selecionar QR Code ${record.code}`}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-800">{record.code}</td>
                      <td className="px-4 py-4">{record.name}</td>
                      <td className="px-4 py-4">{record.client_name}</td>
                      <td className="max-w-xs px-4 py-4 truncate text-slate-500">{record.destination_url}</td>
                      <td className="px-4 py-4">{record.scan_count}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            record.active
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {record.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            title="Visualizar"
                            aria-label={`Visualizar QR Code ${record.code}`}
                            onClick={() => {
                              const detail = records.find((item) => item.id === record.id)
                              if (detail) {
                                setSelectedQr(detail)
                              }
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                          >
                            👁
                          </button>
                          <button
                            type="button"
                            title={record.active ? 'Desativar' : 'Ativar'}
                            aria-label={record.active ? `Desativar QR Code ${record.code}` : `Ativar QR Code ${record.code}`}
                            onClick={() => toggleStatus(record.id)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-700 transition hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700"
                          >
                            {record.active ? '⏸' : '▶'}
                          </button>
                          <button
                            type="button"
                            title="Editar"
                            aria-label={`Editar QR Code ${record.code}`}
                            onClick={() => {
                              const detail = records.find((item) => item.id === record.id)
                              if (detail) {
                                setSelectedQr(detail)
                              }
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            title="Baixar PNG"
                            aria-label={`Baixar PNG do QR Code ${record.code}`}
                            onClick={() => void downloadQrPng(record)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-base text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                          >
                            ⬇️
                          </button>
                          <button
                            type="button"
                            title="Excluir"
                            aria-label={`Excluir QR Code ${record.code}`}
                            onClick={() => void deleteQr(record.id)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-base text-red-700 transition hover:bg-red-100"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    client_name: '',
    destination_url: '',
  })

  const renderCreateQr = () => (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="mb-6 text-xl font-semibold text-slate-800">Criar QR Code</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-700">
          <span>Código</span>
          <input
            value={formData.code}
            onChange={(event) => setFormData((current) => ({ ...current, code: event.target.value }))}
            placeholder="QR001"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-700">
          <span>Nome</span>
          <input
            value={formData.name}
            onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
            placeholder="Restaurante Sabor & Cia"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-700 md:col-span-2">
          <span>Cliente</span>
          <input
            value={formData.client_name}
            onChange={(event) => setFormData((current) => ({ ...current, client_name: event.target.value }))}
            placeholder="Restaurante Sabor & Cia"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
          />
        </label>
        <label className="space-y-2 text-sm text-slate-700 md:col-span-2">
          <span>URL de destino</span>
          <input
            value={formData.destination_url}
            onChange={(event) => setFormData((current) => ({ ...current, destination_url: event.target.value }))}
            placeholder="https://instagram.com/"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
          />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
            onClick={() => {
              void createQr(formData).then((created) => {
                if (!created) return
              setFormData({ code: '', name: '', client_name: '', destination_url: '' })
              })
          }}
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Salvar QR Code
        </button>
      </div>
    </div>
  )

  const renderBatch = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="mb-4 text-xl font-semibold text-slate-800">Criar lote</h2>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-slate-500">Máximo de 100 QR Codes por lote</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void createStockBatch()}
              className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
            >
              Gerar 100 inativos
            </button>
            <button
              type="button"
              onClick={handleBatchManualAdd}
              disabled={batchRows.length >= 100}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Adicionar linha
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {batchRows.map((row, index) => (
            <div key={`batch-${index}`} className="grid gap-3 md:grid-cols-5">
              <input
                value={row.code}
                onChange={(event) => updateBatchRow(index, 'code', event.target.value)}
                placeholder="Código"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white"
              />
              <input
                value={row.name}
                onChange={(event) => updateBatchRow(index, 'name', event.target.value)}
                placeholder="Nome"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white"
              />
              <input
                value={row.client_name}
                onChange={(event) => updateBatchRow(index, 'client_name', event.target.value)}
                placeholder="Cliente"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white"
              />
              <input
                value={row.destination_url}
                onChange={(event) => updateBatchRow(index, 'destination_url', event.target.value)}
                placeholder="URL de destino"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:bg-white md:col-span-2"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void createBatchFromRows()}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Gerar QR Codes
          </button>
          <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Importar CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  handleCsvUpload(file)
                }
              }}
            />
          </label>
        </div>
      </div>

      {csvPreview && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h3 className="text-lg font-semibold text-slate-800">Prévia do CSV</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <InfoBadge label="Registros" value={String(csvPreview.rows.length)} />
            <InfoBadge label="Válidos" value={String(csvPreview.valid)} />
            <InfoBadge label="Inválidos" value={String(csvPreview.invalid)} />
            <InfoBadge label="Duplicados" value={String(csvPreview.duplicates.length)} />
          </div>

          {csvPreview.errors.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <ul className="list-disc space-y-1 pl-5">
                {csvPreview.errors.slice(0, 6).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => void createBatchFromCsv()}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Confirmar importação
            </button>
            <button
              type="button"
              onClick={() => setCsvPreview(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Limpar prévia
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const renderSettings = () => (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-xl font-semibold text-slate-800">Configurações</h2>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <p><strong>Modo de autenticação:</strong> {supabase ? 'Supabase Auth ativo' : 'Modo local demo'}</p>
          <p><strong>Base pública:</strong> {new URL(import.meta.env.BASE_URL, window.location.href).toString()}</p>
          <p><strong>QR dinâmico:</strong> {buildDynamicUrl('QR001')}</p>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={exportAllCsv}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={downloadZip}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Baixar ZIP
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <Routes>
        <Route
          path="/login"
          element={authLoading ? (
            <PageMessage title="Carregando..." description="Validando a sessão." />
          ) : authState.isAuthenticated ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage onLogin={handleLogin} />
          )}
        />

        <Route
          path="*"
          element={
            authLoading ? (
              <PageMessage title="Carregando..." description="Validando a sessão." />
            ) : isSupabaseInviteCallback ? (
              <InvitePasswordPage />
            ) : authState.isAuthenticated ? (
              <AppShell
                onLogout={handleLogout}
                loading={recordsLoading}
                selectedQr={selectedQr}
                setSelectedQr={setSelectedQr}
                onSaveQr={async (payload) => {
                  if (!selectedQr) return
                  const validUrl = payload.destination_url.trim()
                  if (!payload.name.trim() || !payload.client_name.trim() || !validUrl) {
                    showToast('Nome, cliente e URL são obrigatórios.', 'error')
                    return
                  }
                  if (!validateUrl(validUrl)) {
                    showToast('URL inválida. Informe uma URL válida.', 'error')
                    return
                  }
                  const updated = await updateQr(selectedQr.id, {
                    name: payload.name.trim(),
                    client_name: payload.client_name.trim(),
                    destination_url: validUrl,
                    active: payload.active,
                  })
                  if (!updated) return
                  showToast(`QR ${selectedQr.code} atualizado com sucesso.`, 'success')
                  setSelectedQr(null)
                }}
                renderDashboard={renderDashboard}
                renderQrCodes={renderQrCodes}
                renderCreateQr={renderCreateQr}
                renderBatch={renderBatch}
                renderSettings={renderSettings}
                email={authState.email}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route path="/r/:code" element={<PublicRedirectPage records={records} setRecords={setRecords} />} />
      </Routes>

      {toast && (
        <div
          className={`fixed bottom-5 right-5 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'error'
              ? 'bg-red-600 text-white'
              : toast.kind === 'info'
                ? 'bg-slate-800 text-white'
                : 'bg-emerald-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState(supabase ? '' : DEMO_EMAIL)
  const [password, setPassword] = useState(supabase ? '' : DEMO_PASSWORD)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)

    try {
      await onLogin(email, password)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-soft">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">QR Manager</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Painel Privado</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-slate-700">
            <span className="mb-2 block">E-mail</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
            />
          </label>

          <label className="block text-sm text-slate-700">
            <span className="mb-2 block">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          {supabase ? 'Autenticação Supabase habilitada.' : 'Modo local de desenvolvimento ativo. Login padrão: admin@qrmanager.local / admin123'}
        </p>
      </div>
    </div>
  )
}

function InvitePasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage('')

    if (password.length < 8) {
      setErrorMessage('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirmation) {
      setErrorMessage('As senhas não coincidem.')
      return
    }
    if (!supabase) {
      setErrorMessage('A configuração do Supabase não foi encontrada.')
      return
    }

    setLoading(true)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session) throw new Error('O convite expirou. Solicite um novo convite ao administrador.')

      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      navigate('/', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível definir a senha.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-soft">
        <div className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">QR Manager</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Defina sua senha</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm text-slate-700">
            <span className="mb-2 block">Nova senha</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
            />
          </label>
          <label className="block text-sm text-slate-700">
            <span className="mb-2 block">Confirmar senha</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-brand-500 focus:bg-white"
            />
          </label>
          {errorMessage && <p role="alert" className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Salvando...' : 'Salvar senha'}
          </button>
        </form>
      </div>
    </div>
  )
}

function AppShell({
  onLogout,
  loading,
  renderDashboard,
  renderQrCodes,
  renderCreateQr,
  renderBatch,
  renderSettings,
  email,
  selectedQr,
  setSelectedQr,
  onSaveQr,
}: {
  onLogout: () => Promise<void> | void
  loading: boolean
  renderDashboard: () => ReactNode
  renderQrCodes: () => ReactNode
  renderCreateQr: () => ReactNode
  renderBatch: () => ReactNode
  renderSettings: () => ReactNode
  email: string | null
  selectedQr: QrRecord | null
  setSelectedQr: (value: QrRecord | null) => void
  onSaveQr: (payload: { name: string; client_name: string; destination_url: string; active: boolean }) => Promise<void>
}) {
  const navigation = [
    { to: '/', label: 'Dashboard' },
    { to: '/qr-codes', label: 'QR Codes' },
    { to: '/create', label: 'Criar QR' },
    { to: '/batch', label: 'Criar Lote' },
    { to: '/settings', label: 'Configurações' },
  ]

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-soft md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">QR Manager</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Dashboard privado</h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">{email ?? 'Admin'}</span>
          <button
            type="button"
            onClick={() => onLogout()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-soft lg:max-w-[220px]">
          <nav className="space-y-2">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex-1">
          {loading ? (
            <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Carregando QR Codes...</p>
          ) : (
            <Routes>
              <Route path="/" element={renderDashboard()} />
              <Route path="/qr-codes" element={renderQrCodes()} />
              <Route path="/create" element={renderCreateQr()} />
              <Route path="/batch" element={renderBatch()} />
              <Route path="/settings" element={renderSettings()} />
            </Routes>
          )}
        </main>
      </div>

      <QrDetailModal
        key={selectedQr?.id ?? 'closed'}
        data={selectedQr}
        onClose={() => setSelectedQr(null)}
        onSave={onSaveQr}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: 'blue' | 'green' | 'slate' | 'violet' }) {
  const tone = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-700',
    violet: 'bg-violet-50 text-violet-700',
  }[accent]

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className={`mb-3 inline-flex rounded-xl px-2.5 py-1.5 text-xs font-medium ${tone}`}>{label}</div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
    </div>
  )
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-800">{value}</div>
    </div>
  )
}

function QrDetailModal({
  data,
  onClose,
  onSave,
}: {
  data: QrRecord | null
  onClose: () => void
  onSave: (payload: { name: string; client_name: string; destination_url: string; active: boolean }) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => ({
    name: data?.name ?? '',
    client_name: data?.client_name ?? '',
    destination_url: data?.destination_url ?? '',
    active: data?.active ?? true,
  }))
  const [qrImage, setQrImage] = useState<string>('')

  useEffect(() => {
    if (!data) return

    void QRCode.toDataURL(buildDynamicUrl(data.code), {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    }).then((value) => setQrImage(value))
  }, [data])

  if (!data) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-slate-900">Detalhes do QR Code</h3>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            Fechar
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            {qrImage ? (
              <img
                src={qrImage}
                alt={`QR ${data.code}`}
                className="w-full rounded-lg"
              />
            ) : (
              <div className="flex h-[220px] items-center justify-center rounded-lg bg-slate-200 text-sm text-slate-500">
                Gerando QR...
              </div>
            )}
          </div>

          <div className="space-y-3 text-sm text-slate-700">
            <p><strong>Código:</strong> {data.code}</p>
            <p><strong>URL dinâmica:</strong> {buildDynamicUrl(data.code)}</p>
            <p><strong>Scans:</strong> {data.scan_count}</p>
            <p><strong>Último scan:</strong> {formatDate(data.last_scan_at)}</p>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Nome</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Cliente</span>
              <input
                value={draft.client_name}
                onChange={(event) => setDraft((current) => ({ ...current, client_name: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">URL de destino</span>
              <input
                value={draft.destination_url}
                onChange={(event) => setDraft((current) => ({ ...current, destination_url: event.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
              />
              QR ativo
            </label>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void onSave(draft)}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => window.open(buildDynamicUrl(data.code), '_blank')}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Testar QR
              </button>
              <button
                type="button"
                onClick={async () => {
                  const imageUrl = await QRCode.toDataURL(buildDynamicUrl(data.code), {
                    errorCorrectionLevel: 'M',
                    width: 1200,
                    margin: 1,
                    type: 'image/png',
                  })
                  const blob = await fetch(imageUrl).then((response) => response.blob())
                  downloadBlob(blob, `${safeFileName(data.code)}-${safeFileName(data.name)}.png`)
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Baixar PNG
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PublicRedirectPage({
  records,
  setRecords,
}: {
  records: QrRecord[]
  setRecords: Dispatch<SetStateAction<QrRecord[]>>
}) {
  const { code } = useParams()
  const [redirectState, setRedirectState] = useState<'loading' | 'not-found' | 'inactive' | 'redirecting' | 'error'>('loading')
  const currentRecords = useRef(records)
  const publicResolution = useRef<{ code: string; result: ReturnType<typeof resolvePublicQrCode> } | null>(null)

  useEffect(() => {
    currentRecords.current = records
  }, [records])

  useEffect(() => {
    if (!code) return
    const normalizedCode = String(code).trim().toUpperCase()
    let cancelled = false

    const redirect = async () => {
      if (supabase) {
        try {
          if (publicResolution.current?.code !== normalizedCode) {
            publicResolution.current = {
              code: normalizedCode,
              result: resolvePublicQrCode(normalizedCode),
            }
          }
          const result = await publicResolution.current.result
          if (cancelled) return
          if (!result) {
            setRedirectState('not-found')
            return
          }
          if (!result.active) {
            setRedirectState('inactive')
            return
          }
          if (!result.destination_url) {
            setRedirectState('error')
            return
          }

          setRedirectState('redirecting')
          window.location.assign(result.destination_url)
        } catch {
          if (!cancelled) setRedirectState('error')
        }
        return
      }

      const record = currentRecords.current.find((entry) => entry.code.toUpperCase() === normalizedCode)
      if (!record) {
        setRedirectState('not-found')
        return
      }
      if (!record.active) {
        setRedirectState('inactive')
        return
      }

      setRecords((current) =>
        current.map((entry) =>
          entry.id === record.id
            ? {
                ...entry,
                scan_count: entry.scan_count + 1,
                last_scan_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
            : entry,
        ),
      )
      setRedirectState('redirecting')
      window.location.assign(record.destination_url)
    }

    void redirect()
    return () => {
      cancelled = true
    }
  }, [code, setRecords])

  if (redirectState === 'not-found') {
    return <PageMessage title="QR Code não encontrado" description="Este código não está cadastrado no sistema." />
  }

  if (redirectState === 'inactive') {
    return <PageMessage title="Este QR Code está temporariamente indisponível." description="Tente novamente mais tarde." />
  }
  if (redirectState === 'error') {
    return <PageMessage title="Não foi possível redirecionar" description="Tente novamente mais tarde ou contate o administrador." />
  }

  return <PageMessage title="Redirecionando..." description="Aguarde um momento." />
}

function PageMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-soft">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-slate-600">{description}</p>
      </div>
    </div>
  )
}

export default function RootApp() {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  )
}
