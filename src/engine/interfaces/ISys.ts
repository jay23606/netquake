import IAssetStore from "./store/IAssetStore";

export interface ISys {
  print: (text: string) => void,
  quit: (reason?: string) => void,
  floatTime: () => number,
  error: (text: string) => void,
  getExternalCommand: () => string,
  init: (argv: string) => void,
  assetStore: IAssetStore,
  requestPak: () => Promise<any>,
  // The local player renamed in-game; lets the host environment sync its
  // own name storage. Absent on the dedicated server.
  nameChanged?: (name: string) => void
}