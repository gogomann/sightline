declare module 'vt-pbf' {
  function fromGeojsonVt(layers: Record<string, unknown>, options?: { version?: number }): Uint8Array;
  export { fromGeojsonVt };
}