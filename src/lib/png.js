// Minimal PNG decoder (8-bit, non-interlaced) so the Worker can read radar tile pixels.
// Supports colour types 6 (RGBA), 3 (palette + tRNS), 4 (gray+alpha). Opaque types throw
// because transparency is how RainViewer tiles encode "no echo".
async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 33 || sig.some((b, i) => buf[i] !== b)) throw new Error("not a PNG");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = dv.getUint32(off + 8); h = dv.getUint32(off + 12); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (il !== 0) throw new Error("interlaced PNG unsupported");
  if (bd !== 8) throw new Error("bit depth " + bd + " unsupported");
  if (![6, 3, 4].includes(ct)) throw new Error("colour type " + ct + " has no usable alpha");
  const total = idat.reduce((n, a) => n + a.length, 0);
  const z = new Uint8Array(total);
  let p = 0; for (const a of idat) { z.set(a, p); p += a.length; }
  const raw = await inflate(z);
  const ch = ct === 6 ? 4 : ct === 4 ? 2 : 1;
  const stride = w * ch;
  if (raw.length < h * (stride + 1)) throw new Error("PNG data truncated");
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= ch && y > 0 ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error("bad PNG filter " + f);
      out[dst + x] = v & 255;
    }
  }
  const pixel = (x, y) => {
    const i = y * stride + x * ch;
    if (ct === 6) return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    if (ct === 4) return [out[i], out[i], out[i], out[i + 1]];
    const idx = out[i];
    return [plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255];
  };
  // Alpha plane without per-pixel allocations (used for whole-tile radar analysis).
  const alpha = () => {
    const a = new Uint8Array(w * h);
    if (ct === 6) for (let i = 0; i < a.length; i++) a[i] = out[i * 4 + 3];
    else if (ct === 4) for (let i = 0; i < a.length; i++) a[i] = out[i * 2 + 1];
    else { const lut = new Uint8Array(256).fill(255); if (trns) for (let i = 0; i < trns.length; i++) lut[i] = trns[i]; for (let i = 0; i < a.length; i++) a[i] = lut[out[i]]; }
    return a;
  };
  return { w, h, ct, pixel, alpha };
}
