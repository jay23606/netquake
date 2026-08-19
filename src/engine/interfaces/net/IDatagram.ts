export default interface IDatagram {
  data: ArrayBuffer;
  cursize: number;
  allowoverflow?: boolean;
  overflowed?: boolean;
  // cached views over data, lazily (re)built by sz.dataView/sz.u8 on buffer identity
  // change -- never construct views over data directly in per-frame code
  view?: DataView;
  u8?: Uint8Array;
}