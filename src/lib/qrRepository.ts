import { supabase } from './supabase'
import type { QrRecord } from './qr'

export type PublicQrResult = {
  destination_url: string | null
  active: boolean
}

function getClient() {
  if (!supabase) {
    throw new Error('Configure o Supabase para usar dados compartilhados.')
  }

  return supabase
}

export async function listQrRecords(): Promise<QrRecord[]> {
  const { data, error } = await getClient()
    .from('qr_codes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as QrRecord[]
}

export async function insertQrRecords(records: QrRecord[]): Promise<QrRecord[]> {
  const { data, error } = await getClient()
    .from('qr_codes')
    .insert(records)
    .select('*')

  if (error) throw error
  return data as QrRecord[]
}

export async function updateQrRecord(
  id: string,
  updates: Partial<Pick<QrRecord, 'name' | 'client_name' | 'destination_url' | 'active'>>,
): Promise<QrRecord> {
  const { data, error } = await getClient()
    .from('qr_codes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as QrRecord
}

export async function deleteQrRecord(id: string): Promise<void> {
  const { error } = await getClient().from('qr_codes').delete().eq('id', id)
  if (error) throw error
}

export async function resolvePublicQrCode(code: string): Promise<PublicQrResult | null> {
  const { data, error } = await getClient().rpc('resolve_qr_code', { p_code: code })
  if (error) throw error

  const rows = Array.isArray(data) ? data : data ? [data] : []
  return (rows[0] as PublicQrResult | undefined) ?? null
}