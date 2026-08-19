import { FTEBroker } from '../../../shared/webrtc/FTEBroker'
import { Signaling } from '../../../shared/webrtc/signaling'
import { defaultConfiguration } from '../../../shared/webrtc/configuration'

const brokerAddress = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://master.quakeone.com:27950`

export type ProbeResult = {
  rtt: number
  remoteAddress?: string
}

/**
 * Measures RTT to a WebRTC game server via a lightweight ICE probe.
 *
 * Opens a short-lived peer connection through the broker using STUN-only
 * connectivity checks (no DTLS/SCTP), reads currentRoundTripTime from
 * RTCIceCandidatePairStats, then tears everything down.
 *
 * @param serverAddress  The ice-udp/rtc endpoint address from the server list
 * @param timeoutMs      How long to wait before giving up (default 15 s)
 * @returns RTT in milliseconds and the remote candidate IP
 */
export const probeServer = (serverAddress: string, timeoutMs = 15000): Promise<ProbeResult> => {
  return new Promise((resolve, reject) => {
    const hostName = serverAddress.replace(/^\//, '')
    const wsUrl = `${brokerAddress}/FTE-Quake/${hostName}`

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl, ['rtc_probe'])
      ws.binaryType = 'arraybuffer'
    } catch {
      return reject(new Error('Failed to create WebSocket'))
    }

    let rtcPeer: RTCPeerConnection | null = null
    let broker: FTEBroker | null = null
    let candidateCache: RTCIceCandidate[] = []
    let statsInterval: ReturnType<typeof setInterval> | null = null
    let settled = false
    let remoteAddress: string | undefined

    const timeout = setTimeout(() => finish(undefined, new Error('Probe timeout')), timeoutMs)

    const finish = (result?: ProbeResult, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (statsInterval) clearInterval(statsInterval)
      if (rtcPeer) {
        rtcPeer.onicecandidate = null
        rtcPeer.oniceconnectionstatechange = null
        rtcPeer.close()
      }
      if (broker) broker.close()
      if (result) resolve(result)
      else reject(error || new Error('Probe failed'))
    }

    // Extract IP from an ICE candidate SDP string.
    // Format: candidate:foundation component protocol priority address port typ ...
    const parseRemoteIp = (candidateSdp: string) => {
      const parts = candidateSdp.split(/\s+/)
      if (parts.length < 8) return
      const addr = parts[4]
      const typ = parts[7]
      // Skip .local mDNS and link-local addresses
      if (!addr || addr.endsWith('.local') || addr.startsWith('0:')) return
      // Prefer srflx (public IP) over host (private IP)
      if (!remoteAddress || typ === 'srflx') {
        remoteAddress = addr
      }
    }

    const pollStats = async () => {
      if (!rtcPeer || settled) return
      try {
        const stats = await rtcPeer.getStats()
        stats.forEach((report: any) => {
          if (
            report.type === 'candidate-pair' &&
            report.currentRoundTripTime != null &&
            report.currentRoundTripTime > 0
          ) {
            finish({ rtt: Math.round(report.currentRoundTripTime * 1000), remoteAddress })
          }
        })
      } catch { /* stats may not be available yet */ }
    }

    ws.onopen = () => {
      const signaling: Signaling = {
        send: (data) => ws.send(data),
        onmessage: (cb) => ws.addEventListener('message', (e) => cb(e.data)),
        close: () => ws.close()
      }

      broker = new FTEBroker(signaling)

      broker.on('newPeer', async ({ clientId, iceServers }) => {
        rtcPeer = new RTCPeerConnection({
          ...defaultConfiguration,
          iceServers: [...defaultConfiguration.iceServers, ...(iceServers || [])]
        })

        // Data channel ensures the SDP offer has an application m-line for ICE
        rtcPeer.createDataChannel('probe', { negotiated: true, id: 0 })

        rtcPeer.onicecandidate = (e) => {
          if (e.candidate?.candidate && broker) {
            broker.sendCandidate(clientId, e.candidate)
          }
        }

        rtcPeer.oniceconnectionstatechange = () => {
          if (!rtcPeer || settled) return
          const iceState = rtcPeer.iceConnectionState
          if (iceState === 'connected' || iceState === 'completed') {
            pollStats()
            statsInterval = setInterval(pollStats, 50)
          } else if (iceState === 'failed' || iceState === 'closed') {
            // DTLS will fail after STUN succeeds — try one last stats read
            pollStats().then(() => {
              if (!settled) finish(undefined, new Error(`ICE ${iceState}`))
            })
          }
        }

        try {
          const offer = await rtcPeer.createOffer()
          await rtcPeer.setLocalDescription(offer)
          broker.sendOffer(clientId, offer as RTCSessionDescription)
        } catch (e) {
          finish(undefined, e as Error)
        }
      })

      broker.on('offer', async ({ clientId, offerOrAnswer }) => {
        if (!rtcPeer || settled) return
        try {
          await rtcPeer.setRemoteDescription(offerOrAnswer)
          for (const c of candidateCache) {
            await rtcPeer.addIceCandidate(c)
          }
          candidateCache = []
        } catch (e) {
          finish(undefined, e as Error)
        }
      })

      broker.on('candidate', async ({ clientId, candidate }) => {
        if (!candidate || !rtcPeer || settled) return
        // Extract IP from the raw candidate SDP before the browser redacts it
        if (candidate.candidate) {
          parseRemoteIp(candidate.candidate)
        }
        if (!rtcPeer.remoteDescription) {
          candidateCache.push(candidate)
          return
        }
        try {
          await rtcPeer.addIceCandidate(candidate)
        } catch { /* ignore bad candidates */ }
      })

      // Probe is implicit from the rtc_probe subprotocol — broker
      // sends PROBE to the server automatically on connect
    }

    ws.onerror = () => finish(undefined, new Error('WebSocket error'))
    ws.onclose = () => {
      if (!settled) finish(undefined, new Error('WebSocket closed'))
    }
  })
}
