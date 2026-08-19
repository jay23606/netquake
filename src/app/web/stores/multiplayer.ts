import axios from 'axios'
import { defineStore } from 'pinia'
import { probeServer } from '../util/webrtcProbe'

const masterServerUrl = '/api/server'

export type ServerEndpoint = {
  type: string
  address: string
}

export type PlayerStatus = {
  nameBase64: string
  connectedTime: number
  frags: number
  colors: number
  isBot?: boolean
}

type HasEndpoints = { endpoints: ServerEndpoint[] }

export const humanPlayerCount = (server: { players: PlayerStatus[] }): number =>
  server.players.filter(p => !p.isBot).length

// Merged view for display — components consume this type
export type ServerStatus = {
  key: string
  endpoints: ServerEndpoint[]
  game: string
  lastQuery: number
  location: string
  map: string
  maxPlayers: number
  name: string
  players: PlayerStatus[]
  ping: string
  remoteAddress?: string
}

// Raw server data from the master server API
type ServerListItem = {
  endpoints: ServerEndpoint[]
  name: string
  location: string
  game: string
  lastQuery: number
  players: PlayerStatus[]
  map: string
  maxPlayers: number
}

type ServerInfo = ServerListItem & { key: string }

// Derived status from pinging, probing, and geolocation
type DerivedStatus = {
  ping: number | '??'
  remoteAddress?: string
  location?: string
}

export const getWsEndpoint = (server: HasEndpoints): ServerEndpoint | undefined =>
  server.endpoints.find(e => e.type === 'ws')

export const getIceUdpEndpoint = (server: HasEndpoints): ServerEndpoint | undefined =>
  server.endpoints.find(e => e.type === 'ice-udp')

export const getRtcEndpoint = (server: HasEndpoints): ServerEndpoint | undefined =>
  server.endpoints.find(e => e.type === 'rtc')

export const getConnectUrl = (server: HasEndpoints): string | undefined => {
  const ws = getWsEndpoint(server)
  if (ws) return ws.address
  const iceUdp = getIceUdpEndpoint(server)
  if (iceUdp) return `rtc://${iceUdp.address.replace(/^\//, '')}`
  const rtc = getRtcEndpoint(server)
  if (rtc) return `rtc://${rtc.address.replace(/^\//, '')}`
  return undefined
}

interface State {
  servers: Record<string, ServerInfo>
  statuses: Record<string, DerivedStatus>
  refreshError: boolean
  autoRefresh: boolean
}

export const useMultiplayerStore = defineStore('mutiplayer', {
  state: (): State => ({
    servers: {},
    statuses: {},
    autoRefresh: false,
    refreshError: false
  }),
  getters: {
    getServerStatuses (state): Record<string, ServerStatus> {
      const result: Record<string, ServerStatus> = {}
      for (const key in state.servers) {
        const server = state.servers[key]
        const status = state.statuses[key]
        result[key] = {
          ...server,
          ping: status?.ping != null ? String(status.ping) : '..',
          remoteAddress: status?.remoteAddress,
          location: status?.location || server.location,
        }
      }
      return result
    },
    getAutoRefersh: (state) => state.autoRefresh
  },
  actions: {
    setServerPing ({serverKey, ping}: {serverKey: string, ping: number | '??'}) {
      if (!this.servers[serverKey]) return
      if (!this.statuses[serverKey]) {
        this.statuses[serverKey] = { ping }
      } else {
        this.statuses[serverKey].ping = ping
      }
    },
    setAutoRefreshOn () {
      this.autoRefresh = true
    },
    setAutoRefreshOff () {
      this.autoRefresh = false
    },
    loadServerStatuses () {
      return axios.get<ServerListItem[]>(masterServerUrl)
        .then(serverStatuses => {
          this.refreshError = false
          this.servers = serverStatuses.data.reduce((agg: Record<string, ServerInfo>, server: ServerListItem) => {
            const key = (
              server.endpoints.find(e => e.type === 'ws') ||
              server.endpoints.find(e => e.type === 'ice-udp') ||
              server.endpoints.find(e => e.type === 'rtc')
            )?.address || ''
            if (!key) return agg
            return { ...agg, [key]: { key, ...server } }
          }, {})
        })
        .catch(err => {
          console.log('Server refresh error')
          console.log(err)
          this.refreshError = true
        })
    },
    pingAllServers () {
      return Object.keys(this.servers).map(key => {
        const server = this.servers[key]
        const wsEndpoint = getWsEndpoint(server)
        if (!wsEndpoint) return Promise.resolve()
        return pingServer(wsEndpoint.address)
          .then(time => this.setServerPing({serverKey: key, ping: time}))
          .catch(() => this.setServerPing({serverKey: key, ping: '??'}))
      })
    },
    probeRtcServers () {
      Object.keys(this.servers).forEach(key => {
        const server = this.servers[key]
        if (getWsEndpoint(server)) return
        const endpoint = getIceUdpEndpoint(server) || getRtcEndpoint(server)
        if (!endpoint) return
        probeServer(endpoint.address)
          .then(({ rtt, remoteAddress }) => {
            this.setServerPing({serverKey: key, ping: rtt})
            if (remoteAddress && this.statuses[key]) {
              this.statuses[key].remoteAddress = remoteAddress
              // Only geolocate once per server
              if (!this.statuses[key].location) {
                geolocateIp(remoteAddress).then(location => {
                  if (location && this.statuses[key]) {
                    this.statuses[key].location = location
                  }
                })
              }
            }
          })
          .catch(() => {
            this.setServerPing({serverKey: key, ping: '??'})
          })
      })
    },
    refresh () {
      return this.loadServerStatuses().then(() => {
        this.pingAllServers()
        this.probeRtcServers()
      })
    },
    refreshLoop (tick = 0) {
      const work = this.getAutoRefersh
        ? (tick % pingEveryNth === 0 ? this.refresh() : this.loadServerStatuses())
        : Promise.resolve()
      return work
        .then(() => {
          setTimeout(() => {
            this.refreshLoop(tick + 1)
          }, serverRefreshTime)
        })
    }
  }
})

const serverRefreshTime = 10000
const pingEveryNth = 6  // ping every 6th tick = 60s
const pingServer = (address: string) => {
  const parsed = new URL(address)
  const path = parsed.pathname.replace(/\/$/, '')
  const url = `https://${parsed.host}${path}/;/ping`
  const start = new Date().getTime()
  return axios.get(url, {timeout: 1000})
    .then(() => {
      const end = new Date().getTime()
      return end - start
    })
}

const geolocateIp = (ip: string): Promise<string | null> =>
  axios.get<{status: string, regionName?: string, country?: string, countryCode?: string}>(
    `/geoip/${ip}?fields=status,regionName,countryCode,country`, { timeout: 3000 }
  )
    .then(({ data }): string | null => {
      if (data.status !== 'success') return null
      if (data.regionName) return `${data.regionName}, ${data.countryCode}`
      return data.country || null
    })
    .catch((): null => null)
