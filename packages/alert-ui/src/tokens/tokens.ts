// 生成物: docs/design/tokens.json から packages/alert-ui/scripts/build-tokens.ts が作る。手で直さない

export const tokens = {
  "color": {
    "trip": {
      "ground": "#FBF8F1",
      "surface": "#FFFFFF",
      "surface-sunken": "#EEF0EA",
      "ink": "#1B2A24",
      "ink-muted": "#4A5A53",
      "ink-faint": "#6B7A73",
      "line": "#E6DFD0",
      "spruce": "#1E6F5C",
      "spruce-deep": "#164F43",
      "on-spruce": "#FFFFFF",
      "clay": "#D86A2B",
      "clay-deep": "#B34E14",
      "alert-safe": "#3FA98C",
      "on-alert-safe": "#0E1512",
      "alert-zone": "#E8A64A",
      "on-alert-zone": "#0E1512",
      "alert-danger": "#E2492C",
      "on-alert-danger": "#FFFFFF",
      "map-water": "#CFE0F2",
      "map-land": "#EEF0EA",
      "photo-placeholder": "#CFDCD4"
    },
    "night": {
      "ground": "#0E1512",
      "surface": "#1A2420",
      "surface-sunken": "#141A17",
      "ink": "#F2F5F1",
      "ink-muted": "#B9C6BF",
      "ink-faint": "#7A8C84",
      "line": "#2C3C34",
      "spruce": "#3FA98C",
      "spruce-deep": "#1E6F5C",
      "on-spruce": "#0E1512",
      "clay": "#F0A26B",
      "clay-deep": "#B34E14",
      "alert-safe": "#3FA98C",
      "on-alert-safe": "#0E1512",
      "alert-zone": "#E8A64A",
      "on-alert-zone": "#0E1512",
      "alert-danger": "#E2492C",
      "on-alert-danger": "#FFFFFF",
      "map-water": "#2A3448",
      "map-land": "#1B2538",
      "photo-placeholder": "#22302A"
    }
  },
  "font": {
    "sans": "\"Noto Sans JP\", \"Hiragino Sans\", system-ui, sans-serif",
    "mono": "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, Menlo, monospace"
  },
  "type": {
    "display-xl": {
      "family": "sans",
      "fontSize": "40px",
      "lineHeight": "50px",
      "fontWeight": 900
    },
    "display-l": {
      "family": "sans",
      "fontSize": "32px",
      "lineHeight": "42px",
      "fontWeight": 900
    },
    "title": {
      "family": "sans",
      "fontSize": "20px",
      "lineHeight": "28px",
      "fontWeight": 900
    },
    "heading": {
      "family": "sans",
      "fontSize": "16px",
      "lineHeight": "24px",
      "fontWeight": 700
    },
    "body": {
      "family": "sans",
      "fontSize": "14px",
      "lineHeight": "24px",
      "fontWeight": 400
    },
    "label": {
      "family": "sans",
      "fontSize": "13px",
      "lineHeight": "18px",
      "fontWeight": 500
    },
    "caption": {
      "family": "sans",
      "fontSize": "12px",
      "lineHeight": "18px",
      "fontWeight": 400
    },
    "eyebrow": {
      "family": "sans",
      "fontSize": "12px",
      "lineHeight": "16px",
      "fontWeight": 700,
      "letterSpacing": "0.12em"
    },
    "num-hero": {
      "family": "mono",
      "fontSize": "96px",
      "lineHeight": "96px",
      "fontWeight": 700
    },
    "num-xl": {
      "family": "mono",
      "fontSize": "40px",
      "lineHeight": "44px",
      "fontWeight": 700
    },
    "num-l": {
      "family": "mono",
      "fontSize": "24px",
      "lineHeight": "28px",
      "fontWeight": 600
    },
    "num-m": {
      "family": "mono",
      "fontSize": "16px",
      "lineHeight": "20px",
      "fontWeight": 600
    },
    "num-s": {
      "family": "mono",
      "fontSize": "12px",
      "lineHeight": "16px",
      "fontWeight": 500
    }
  },
  "space": {
    "space-1": "4px",
    "space-2": "8px",
    "space-3": "12px",
    "space-4": "16px",
    "space-5": "24px",
    "space-6": "40px",
    "space-7": "64px"
  },
  "radius": {
    "radius-s": "6px",
    "radius-m": "10px",
    "radius-l": "14px",
    "radius-xl": "18px",
    "radius-pill": "999px"
  },
  "shadow": {
    "shadow-card": "0 12px 40px rgba(0,0,0,0.25)",
    "shadow-press": "0 6px 0 #164F43",
    "shadow-danger": "0 0 40px 10px rgba(226,73,44,0.6)"
  }
} as const

export type ThemeId = keyof typeof tokens.color
