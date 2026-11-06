import type { Lang } from '@antler/schema'
import { useSyncExternalStore, type PointerEvent } from 'react'
import { releaseFocusAfterPointer } from '../components/hud/pointer-focus'
import type { AudioSettingsStore } from './audio-settings'
import { AUDIO_TEXT } from './audio-text'
import './audio-controls.css'

// 運転の音の操作（docs/specs/drive-audio-chat/functional.md R14）。消音・音量・ラジオ（BGM）。
// 鹿の警告の音（alert-ui）は消さない（R6）。押せる大きさは 44px 以上、アイコンはインライン SVG。

type Props = {
  settings: AudioSettingsStore
  lang: Lang
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M4 9h4l5-4v14l-5-4H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="M17 9l5 6M22 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path
          d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

/** OFF のときは斜線を入れる（押された状態を色だけで伝えない） */
function RadioIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect
        x="3"
        y="8"
        width="18"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M7 8l10-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="15" cy="14" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 12h4M6 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {off ? (
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : null}
    </svg>
  )
}

/** マウスで動かしたスライダーからはフォーカスを外す（そのあとの矢印キーをハンドルにする） */
function releaseSliderAfterPointer(e: PointerEvent<HTMLInputElement>): void {
  e.currentTarget.blur()
}

export function AudioControls({ settings, lang }: Props) {
  const value = useSyncExternalStore(settings.subscribe, settings.getSnapshot)
  const text = AUDIO_TEXT[lang]
  return (
    <div
      className="drive-audio"
      role="group"
      aria-label={text.group}
      lang={lang === 'zh' ? 'zh-TW' : lang}
    >
      <button
        type="button"
        className="drive-audio__button"
        aria-pressed={value.muted}
        aria-label={text.mute}
        onClick={(e) => {
          releaseFocusAfterPointer(e)
          settings.toggleMuted()
        }}
      >
        <SpeakerIcon muted={value.muted} />
      </button>
      <input
        type="range"
        className="drive-audio__volume"
        min={0}
        max={100}
        step={10}
        value={value.volume}
        aria-label={text.volume}
        aria-valuetext={`${String(value.volume)}%`}
        disabled={value.muted}
        onChange={(e) => settings.setVolume(Number(e.currentTarget.value))}
        onPointerUp={releaseSliderAfterPointer}
      />
      <button
        type="button"
        className="drive-audio__button"
        aria-pressed={value.music}
        onClick={(e) => {
          releaseFocusAfterPointer(e)
          settings.toggleMusic()
        }}
      >
        <RadioIcon off={!value.music} />
        <span>{text.music}</span>
      </button>
    </div>
  )
}
