import * as dgram from 'dgram'
import * as dns from 'dns'
import * as con from '../../../engine/console'
import * as cvar from '../../../engine/cvar'
import * as net from '../../../engine/net'
import * as sv from '../../../engine/sv'
import * as pr from '../../../engine/pr'
import * as host from '../../../engine/host'
import * as sys from '../sys'
import { CVars } from '../../../engine/cvar'

export const cvr: CVars = {}

let heartbeatTime = 0
let heartbeatPending = false

export const init = () => {
  cvr.sv_public = cvar.registerVariable('sv_public', host.state.dedicated ? '1' : '0')
  cvr.sv_heartbeat_interval = cvar.registerVariable('sv_heartbeat_interval', '60')
  cvr.sv_reportheartbeats = cvar.registerVariable('sv_reportheartbeats', '0')
  cvr.com_protocolname = cvar.registerVariable('com_protocolname', 'FTE-Quake DarkPlaces-Quake')
  cvr.net_master1 = cvar.registerVariable('net_master1', '')
  cvr.net_master2 = cvar.registerVariable('net_master2', '')
  cvr.net_master3 = cvar.registerVariable('net_master3', '')
  cvr.net_master4 = cvar.registerVariable('net_master4', '')
  cvr.net_masterextra1 = cvar.registerVariable('net_masterextra1', 'master.frag-net.com:27950')
  cvr.net_masterextra2 = cvar.registerVariable('net_masterextra2', 'dpmaster.deathmask.net:27950')
  cvr.net_masterextra3 = cvar.registerVariable('net_masterextra3', 'master.quakeone.com:27950')
}

const getMasterServers = (): string[] => {
  return [
    cvr.net_master1, cvr.net_master2, cvr.net_master3, cvr.net_master4,
    cvr.net_masterextra1, cvr.net_masterextra2, cvr.net_masterextra3
  ].map(c => c.string).filter(s => s.length > 0)
}

const parseMasterAddress = (addr: string): { host: string, port: number } => {
  const lastColon = addr.lastIndexOf(':')
  if (lastColon > 0) {
    const port = parseInt(addr.substring(lastColon + 1))
    if (!isNaN(port)) {
      return { host: addr.substring(0, lastColon), port }
    }
  }
  return { host: addr, port: 27950 }
}

const generateInfoString = (): string => {
  const gameVar = cvar.findVar('game')
  const gamedir = gameVar ? gameVar.string : 'id1'

  let numclients = 0
  let numbots = 0
  for (let i = 0; i < sv.state.svs.maxclients; i++) {
    if (sv.state.svs.clients[i].active) {
      numclients++
      if (!sv.state.svs.clients[i].netconnection) {
        numbots++
      }
    }
  }

  const protocolName = cvr.com_protocolname.string
  const gamename = protocolName.split(' ')[0] || 'FTE-Quake'

  let info = ''
  info += `\\gamename\\${gamename}`
  info += '\\protocol\\3n'
  info += '\\ver\\NetQuake.io'
  info += `\\nqprotocol\\${sv.state.server.protocol}`

  if (gamedir) info += `\\modname\\${gamedir}`

  const mapname = pr.getString(pr.state.globals_int[pr.globalvars.mapname])
  if (mapname) info += `\\mapname\\${mapname}`

  const deathmatch = cvar.findVar('deathmatch')
  if (deathmatch && deathmatch.string) info += `\\deathmatch\\${deathmatch.string}`

  const teamplay = cvar.findVar('teamplay')
  if (teamplay && teamplay.string) info += `\\teamplay\\${teamplay.string}`

  if (net.cvr.hostname.string) info += `\\hostname\\${net.cvr.hostname.string}`

  info += `\\clients\\${numclients}`
  if (numbots > 0) info += `\\bots\\${numbots}`
  info += `\\sv_maxclients\\${sv.state.svs.maxclients}`

  const wsAddr = net.cvr.web_connect_url.string
  if (wsAddr) info += `\\*wsaddr\\${wsAddr}`

  return info
}

/** Handle a connectionless packet (0xFFFFFFFF prefix). Returns true if consumed. */
export const handleConnectionlessPacket = (
  socket: dgram.Socket,
  data: Buffer,
  rinfo: { address: string, port: number }
): boolean => {
  if (data.length < 5) return false
  if (data[0] !== 0xFF || data[1] !== 0xFF || data[2] !== 0xFF || data[3] !== 0xFF) return false

  if (cvr.sv_public.value <= 0) return true

  // Null-terminate and parse command
  const text = data.toString('latin1', 4).split('\0')[0].trim()
  const spaceIdx = text.indexOf(' ')
  const command = spaceIdx >= 0 ? text.substring(0, spaceIdx) : text
  const args = spaceIdx >= 0 ? text.substring(spaceIdx + 1) : ''

  if (command === 'getinfo' || command === 'getstatus') {
    const full = command === 'getstatus'
    const cookie = args

    let response = full ? 'statusResponse\n' : 'infoResponse\n'
    response += generateInfoString()

    if (cookie) {
      response += `\\challenge\\${cookie}`
    }

    if (full) {
      for (let i = 0; i < sv.state.svs.maxclients; i++) {
        const client = sv.state.svs.clients[i]
        if (client.active) {
          const frags = Math.floor(client.edict.v_float[pr.entvars.frags])
          const name = sv.getClientName(client)
          const colors = client.colors
          response += `\n${frags} 0 ${colors & 15}_${colors >> 4} "${name}"`
        }
      }
    }

    // Build packet: 4 bytes 0xFF header + response text
    const header = Buffer.alloc(4, 0xFF)
    const body = Buffer.from(response, 'latin1')
    const packet = Buffer.concat([header, body])
    socket.send(packet, 0, packet.length, rinfo.port, rinfo.address)
    return true
  }

  return true // connectionless packet but not one we handle - consume it anyway
}

/** Check if it's time to send heartbeats. Called every server frame. */
export const checkHeartbeat = (socket: dgram.Socket) => {
  if (!socket) return
  if (cvr.sv_public.value <= 0) return

  const now = sys.floatTime()
  if (now < heartbeatTime) return
  if (heartbeatPending) return

  heartbeatPending = true
  heartbeatTime = now + Math.max(30, cvr.sv_heartbeat_interval.value)

  sendHeartbeats(socket)
}

/** Trigger an immediate heartbeat on next frame. */
export const triggerHeartbeat = () => {
  heartbeatTime = 0
}

const sendHeartbeats = async (socket: dgram.Socket) => {
  const masters = getMasterServers()
  if (masters.length === 0) {
    heartbeatPending = false
    return
  }

  const heartbeatPacket = Buffer.alloc(4 + 21)
  heartbeatPacket[0] = heartbeatPacket[1] = heartbeatPacket[2] = heartbeatPacket[3] = 0xFF
  heartbeatPacket.write('heartbeat DarkPlaces\n', 4)

  for (const master of masters) {
    const { host, port } = parseMasterAddress(master)
    try {
      const address = await new Promise<string>((resolve, reject) => {
        dns.lookup(host, 4, (err, addr) => {
          if (err) reject(err)
          else resolve(addr)
        })
      })

      if (cvr.sv_reportheartbeats.value > 0) {
        con.print(`Sending heartbeat to ${master} (${address}:${port})\n`)
      }

      socket.send(heartbeatPacket, 0, heartbeatPacket.length, port, address)
    } catch (e) {
      if (cvr.sv_reportheartbeats.value > 0) {
        con.print(`Unable to resolve master ${master}\n`)
      }
    }
  }

  heartbeatPending = false
}
