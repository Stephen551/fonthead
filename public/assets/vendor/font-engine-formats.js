/* ============================================================
 * font-engine-formats.js  (WOFF1 + WOFF2 wrappers)
 * ------------------------------------------------------------
 * Worker-only. Wraps an OTF/TTF byte stream into web font
 * containers. Depends on:
 *   - CompressionStream('deflate') (Chrome 80+, FF 113+, Safari 16.4+)
 *   - wawoff2 Module (loaded via importScripts before this script)
 *
 * Public entries:
 *   wrapAsWoff1(sfntBytes) -> Uint8Array
 *   wrapAsWoff2(sfntBytes) -> Promise<Uint8Array>
 *
 * wawoff2 readiness is owned by the worker entrypoint (it sets
 * up the Module.onRuntimeInitialized promise BEFORE importing the
 * binding); this module just awaits the shared `wawoff2Ready`.
 * ============================================================ */
(function(global){
  'use strict';

  async function deflateRaw(bytes) {
    /* CompressionStream('deflate') emits a real zlib stream
       (2-byte header + DEFLATE data + 4-byte adler32) — which is
       exactly the format WOFF1 stores per-table. */
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  async function wrapAsWoff1(sfntBytes) {
    const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
    const sfntVersion = view.getUint32(0, false);
    const numTables = view.getUint16(4, false);

    /* Parse SFNT directory */
    const tables = [];
    for (let i = 0; i < numTables; i++) {
      const recOff = 12 + i * 16;
      tables.push({
        tag: view.getUint32(recOff, false),
        checksum: view.getUint32(recOff + 4, false),
        offset: view.getUint32(recOff + 8, false),
        length: view.getUint32(recOff + 12, false),
      });
    }

    /* WOFF1 spec requires the WOFF directory be sorted by tag (mirrors
       SFNT requirement). opentype.js already emits sorted tables so
       this is usually a no-op, but explicit ordering protects against
       any source whose directory is out of order. */
    tables.sort((a, b) => a.tag - b.tag);

    /* Per-table compression — keep the smaller of (compressed | raw). */
    const entries = [];
    for (const t of tables) {
      const raw = sfntBytes.subarray(t.offset, t.offset + t.length);
      const compressed = await deflateRaw(raw);
      const data = compressed.length < raw.length ? compressed : raw;
      entries.push({
        tag: t.tag,
        origLength: t.length,
        compLength: data.length,
        origChecksum: t.checksum,
        data,
      });
    }

    /* WOFF body size = sum of per-table data, each padded to 4-byte
       alignment. */
    const dirSize = numTables * 20;
    const headerSize = 44;
    let bodySize = 0;
    for (const e of entries) {
      bodySize += e.data.length;
      if (bodySize % 4 !== 0) bodySize += 4 - (bodySize % 4);
    }
    const totalSize = headerSize + dirSize + bodySize;

    /* totalSfntSize per spec: would-be uncompressed SFNT including
       per-table padding. */
    let totalSfntSize = 12 + numTables * 16;
    for (const e of entries) {
      totalSfntSize += e.origLength;
      if (totalSfntSize % 4 !== 0) totalSfntSize += 4 - (totalSfntSize % 4);
    }

    const out = new Uint8Array(totalSize);
    const dv = new DataView(out.buffer);

    /* Header (44 bytes) */
    dv.setUint32(0,  0x774F4646, false);   /* "wOFF" */
    dv.setUint32(4,  sfntVersion, false);
    dv.setUint32(8,  totalSize, false);
    dv.setUint16(12, numTables, false);
    dv.setUint16(14, 0, false);            /* reserved */
    dv.setUint32(16, totalSfntSize, false);
    dv.setUint16(20, 1, false);            /* major version */
    dv.setUint16(22, 0, false);            /* minor version */
    dv.setUint32(24, 0, false);            /* metaOffset */
    dv.setUint32(28, 0, false);            /* metaLength */
    dv.setUint32(32, 0, false);            /* metaOrigLength */
    dv.setUint32(36, 0, false);            /* privOffset */
    dv.setUint32(40, 0, false);            /* privLength */

    /* Directory entries (20 bytes each) + table bodies */
    let dirOff = headerSize;
    let dataOff = headerSize + dirSize;
    for (const e of entries) {
      dv.setUint32(dirOff,      e.tag, false);
      dv.setUint32(dirOff + 4,  dataOff, false);
      dv.setUint32(dirOff + 8,  e.compLength, false);
      dv.setUint32(dirOff + 12, e.origLength, false);
      dv.setUint32(dirOff + 16, e.origChecksum, false);
      out.set(e.data, dataOff);
      dataOff += e.data.length;
      while (dataOff % 4 !== 0) dataOff++;
      dirOff += 20;
    }

    return out;
  }

  async function wrapAsWoff2(sfntBytes) {
    /* `wawoff2Ready` is a Promise that the worker entrypoint sets up
       and exposes as a self-level global before this script loads. */
    if (typeof wawoff2Ready === 'undefined') {
      throw new Error('wawoff2Ready not in scope (worker entrypoint must set it up)');
    }
    await wawoff2Ready;
    const result = Module.compress(sfntBytes);
    if (!result) throw new Error('WOFF2 compression returned no data');
    /* Module.compress hands back a Uint8Array view into the Emscripten
       WASM heap. That buffer is shared with the WASM module — it's
       NOT detachable. If we return it as-is, the worker's postMessage
       transfer list ("transfer ownership of these buffers") throws
       "ArrayBuffer is not detachable and could not be transferred."
       Copy into a fresh ArrayBuffer that IS detachable. */
    const view = result instanceof Uint8Array ? result : new Uint8Array(result);
    const out = new Uint8Array(view.length);
    out.set(view);
    return out;
  }

  global.deflateRaw = deflateRaw;
  global.wrapAsWoff1 = wrapAsWoff1;
  global.wrapAsWoff2 = wrapAsWoff2;
})(typeof self !== 'undefined' ? self : this);
