export type SocketProtocol = 'nqnetchan' | 'default'

export default interface ISocket {
  connecttime: number,
  lastMessageTime: number,
  driver: number,
  address: string,
  disconnected: boolean,
  canSend: boolean,
  protocol?: SocketProtocol,
  ccreqSent?: boolean,
  fragmentBuffer?: Uint8Array,
  sendNext: boolean,
  receiveMessage: any,
  receiveMessageLength: number,
  driverdata: any,
  // Original udp driver fields
  sendMessage: any,
  sendMessageLength: number,
  lastSendTime: number,
  ackSequence: number,
  sendSequence: number,
  unreliableSendSequence: number,
  receiveSequence: number,
  unreliableReceiveSequence: number,
  addr: [string, number],
  messages: Buffer[]
}
