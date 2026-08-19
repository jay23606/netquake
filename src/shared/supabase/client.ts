import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export const supabaseConfigured = (): boolean =>
	Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export const getSupabase = (): SupabaseClient => {
	if (!supabaseConfigured()) {
		throw new Error(
			'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
	}
	if (!client) {
		client = createClient(
			import.meta.env.VITE_SUPABASE_URL,
			import.meta.env.VITE_SUPABASE_ANON_KEY,
			{
				auth: { persistSession: true, autoRefreshToken: true },
				// Signaling is bursty but tiny; the default 10/sec cap is ample and
				// keeps us far away from Realtime quota. Game traffic never comes here.
				realtime: { params: { eventsPerSecond: 10 } },
			})
	}
	return client
}

// ICE servers for the peer connections Supabase brokers. STUN alone covers most
// networks; peers behind symmetric NAT additionally need a TURN relay, which is
// deliberately not configured by default (it costs bandwidth and money).
export const iceServers = (): RTCIceServer[] => {
	const raw = import.meta.env.VITE_ICE_SERVERS
	if (raw) {
		try {
			return JSON.parse(raw) as RTCIceServer[]
		} catch {
			console.warn('VITE_ICE_SERVERS is not valid JSON; falling back to default STUN')
		}
	}
	return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
}
