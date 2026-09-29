import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseInviteCallback =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.hash.slice(1)).get('type') === 'invite'

export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

export const isSupabaseConfigured = Boolean(supabase)
