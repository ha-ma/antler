import { useState } from 'react'

/** WebGL2 が使えるか（R12、UC-7h）。描画のたびに調べ直さない */
export function supportsWebGL2(): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}

export function useWebGL2(check: () => boolean = supportsWebGL2): boolean {
  const [ok] = useState(check)
  return ok
}
