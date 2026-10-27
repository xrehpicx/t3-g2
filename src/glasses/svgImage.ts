/**
 * A page can carry a small chart as inline SVG. The glasses show it in an image container, which takes
 * a PNG up to 288 x 144, so the SVG is drawn on a canvas and sent as a PNG.
 */

export const IMAGE_MAX_W = 288
export const IMAGE_MAX_H = 144
const IMAGE_MIN = 20

/** Splits a reply into its text and the first inline SVG (fenced or bare), if there is one. */
export function extractSvg(reply: string): { text: string; svg: string | null } {
  const fenced = /```(?:svg|xml|html)?\s*\n?(<svg[\s\S]*?<\/svg>)\s*\n?```/i.exec(reply)
  const bare = fenced ?? /(<svg[\s\S]*?<\/svg>)/i.exec(reply)
  if (!bare) return { text: reply, svg: null }
  const svg = bare[1]
  return { text: (reply.slice(0, bare.index) + reply.slice(bare.index + bare[0].length)).replace(/\n{3,}/g, '\n\n').trim(), svg }
}

/** Anything that could run or fetch something: the image is drawn from the page's own text only. */
export function safeSvg(svg: string): boolean {
  return !/<script|<foreignObject|<image|<iframe|<use[\s>]|\son\w+\s*=|(?:href|src)\s*=\s*["']?(?!#)|url\(\s*["']?(?!#)|@import/i.test(svg)
}

/** The size to draw at: as wide as fits, keeping the SVG's proportions. */
export function imageSize(svg: string): { w: number; h: number } {
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(svg)
  const attr = (name: string) => Number(new RegExp(`<svg[^>]*\\s${name}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(svg)?.[1])
  const width = box ? Number(box[1]) : attr('width')
  const height = box ? Number(box[2]) : attr('height')
  const ratio = width > 0 && height > 0 ? height / width : 0.42
  let w = IMAGE_MAX_W
  let h = Math.round(w * ratio)
  if (h > IMAGE_MAX_H) { h = IMAGE_MAX_H; w = Math.round(h / ratio) }
  return { w: Math.max(IMAGE_MIN, w), h: Math.max(IMAGE_MIN, h) }
}

/** A short stable key for a piece of text, to know when the image has to be redrawn. */
export function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export interface RenderedImage { png: Uint8Array; w: number; h: number }

/** Draws the SVG on black (light strokes show up; the glasses draw brightness) and returns a PNG. */
export async function renderSvgPng(svg: string): Promise<RenderedImage | null> {
  if (!safeSvg(svg) || typeof document === 'undefined') return null
  const { w, h } = imageSize(svg)
  const withNs = /xmlns\s*=/.test(svg) ? svg : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  const image = new Image()
  const loaded = new Promise<boolean>(resolve => {
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    setTimeout(() => resolve(false), 4_000)
  })
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`
  if (!(await loaded)) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)
  // Grayscale, with the mid tones lifted: thin lines vanish on the display otherwise.
  const pixels = ctx.getImageData(0, 0, w, h)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const lum = 0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]
    const lifted = Math.min(255, Math.round(255 * Math.pow(lum / 255, 0.7)))
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = lifted
    pixels.data[i + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  return blob ? { png: new Uint8Array(await blob.arrayBuffer()), w, h } : null
}
