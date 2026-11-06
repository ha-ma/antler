import { defineConfig } from 'vite'

// Vercel の関数の bundle（docs/specs/deploy-a/functional.md R1）。
// @antler/*（TS のまま・拡張子なしの相対 import）と src/ は bundle に入れ、node_modules の依存は外に残す
// （Vite の SSR は、リンクされた workspace のパッケージを既定で bundle に入れ、node_modules を外に出す）。
// 外の依存（@resvg/resvg-js のネイティブなど）は Vercel が import を辿って関数に入れる。
// env は焼き込まない（define を使わない。秘密は関数の process.env から読む）。

export default defineConfig({
  // .env を読まない（build の env が bundle に入らないように）
  envDir: false,
  // OG 画像のフォント（Noto Sans JP / TC / KR。OFL）を dist/vercel/ に写す。ライセンス本文（OFL.txt）も一緒に入る。
  // 読むのは src/infrastructure/http/views/og-fonts.ts（handler.mjs と同じ場所のファイル）
  publicDir: 'assets/fonts',
  build: {
    copyPublicDir: true,
    ssr: 'src/vercel.ts',
    outDir: 'dist/vercel',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    // 関数に入れない（ソースを関数のファイルに残さない。security-auditor W5）
    sourcemap: false,
    rolldownOptions: {
      output: { format: 'es', entryFileNames: 'handler.mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
  ssr: { target: 'node' },
})
