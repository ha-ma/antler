import { createContext } from 'react'
import type { AlertSoundController } from './sound-controller'

/**
 * AlertState が音を鳴らすときに使う制御。Provider が無ければ AlertState は鳴らさない（画面だけ）。
 * B の PWA は B-0 で controller.unlock() を呼んでから Provider に渡す。A はアラート ON のときだけ渡す。
 */
export const AlertSoundContext = createContext<AlertSoundController | null>(null)
