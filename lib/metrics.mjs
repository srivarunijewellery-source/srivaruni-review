// Pure pixel math on greyscale buffers. No deps so it can be tested with plain node.

/** Variance of the Laplacian: the classic focus measure. Higher = sharper. */
export function laplacianVariance(buf, w, h) {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * buf[i] - buf[i - 1] - buf[i + 1] - buf[i - w] - buf[i + w];
      sum += l; sumSq += l * l; n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** ponytail: log map of Laplacian variance to 0-100 for 360px-wide frames. Tune SHARPNESS_MIN, not this. */
export function sharpnessScore(variance) {
  return Math.round(100 * Math.min(1, Math.log10(variance + 1) / 3));
}

export function meanBrightness(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s / buf.length;
}

/** Mean absolute difference between two same-size greyscale thumbnails, 0-255. */
export function frameDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Count scene cuts from a series of thumbnail diffs. A cut is a spike well above the local baseline. */
export function countCuts(diffs, threshold = 28) {
  let cuts = 0;
  for (let i = 0; i < diffs.length; i++) if (diffs[i] > threshold) cuts++;
  return cuts;
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
