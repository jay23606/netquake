import ISocket from './ISocket'
import IDatagram from './IDatagram'

export type QConnectStatus = 'connected' | 'failed'
export default interface INetworkDriver {
  initialized: boolean,
  available: boolean,
  name: string,
  init: () => boolean,
  supportedAddress: (connectionAddress: string) => boolean,
  connect: (host: string) => Promise<QConnectStatus | ISocket>,
  checkNewConnections: () => ISocket,
  checkForResend: () => number,
  close: (sock: ISocket) => void,
  canSendMessage: (sock: ISocket) => boolean,
  sendMessage: (sock: ISocket, data: IDatagram) => number,
  sendUnreliableMessage: (sock: ISocket, data: IDatagram) => number,
  getMessage: (sock: ISocket) => any,
  listen: () => void,
  registerWithMaster: () => void,
  shutdown?: () => void,
} 