import { PNG } from 'pngjs';

/** Solid color PNG, optionally with one pixel painted in `dot`. */
export function solidPng(width: number, height: number, rgb: [number, number, number], dot?: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...rgb, 255], i);
  if (dot) png.data.set([...dot, 255], 0);
  return PNG.sync.write(png);
}
