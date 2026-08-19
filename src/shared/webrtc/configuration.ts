export const defaultConfiguration: RTCConfiguration = {
  iceTransportPolicy: 'all',
  bundlePolicy: 'balanced',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 0,
  // STUN servers so Chrome generates srflx candidates with real IPs.
  // Chrome hides local IPs behind mDNS (.local) hostnames; FTE can't
  // resolve those, so without srflx candidates Chrome can't connect to FTE.
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
}