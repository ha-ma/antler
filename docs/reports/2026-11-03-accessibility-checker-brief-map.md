# アクセシビリティチェック結果: brief-map（A-2 出発前ブリーフィング）

対象: `apps/sim/src/features/brief-map/components/*`、`text.ts`、`packages/alert-ui` の AlertState / use-blink（凡例が使うため）。
基準: WCAG 2.1 AA、ch8 / CLAUDE.md（4.5:1、44 px、1 Hz 以下、色だけに頼らない）、仕様 R6・R7・R9。
方法: ソースの読解と、tokens.css の値からの相対輝度の手計算（ブラウザ・スクリーンリーダーでの実測はしていない。下の「実機で確かめるもの」参照）。コードは変更していない。

## Critical（WCAG 違反）: 1 件

- [packages/alert-ui/src/components/use-blink.ts:11-24 ＋ AlertToggleCard.tsx:56-63] 凡例の danger の見本が、ページを開いている間ずっと 1 Hz で点滅し続ける | 基準: WCAG 2.2.2 Pause, Stop, Hide（A） | 内容: `muted` は音を止めるだけで、`useBlink(true)` の setInterval は止まらない（`data-frame` が on/off を繰り返し、14px → compact では 6px の白枠が点滅）。5 秒を超えて自動で始まり、ほかの内容と並行して表示され、凡例の見本なので「不可欠」にも当たらない。しかも use-blink.ts のコメントどおり `prefers-reduced-motion` でも止まらない設計。点滅の頻度は 1 Hz なので 2.3.1（3 回/秒）は満たす。aria-hidden は視覚の点滅を止めない。前庭・注意に困難のある人には、ブリーフィング画面を読む間じゅう視界の端で動くものが残る。 | 修正案（凡例側だけで済む順）: (1) `brief-map.css` に `.brief-legend__screen .antler-alert[data-alert-state='danger'] { border-color: var(--on-alert-danger); }` を足して（`[data-frame]` だけだと safe / zone にも当たる。`data-frame` は常に付く）、見本では枠を常時表示にして見た目の点滅を無くす（CSS のみ、alert-ui の API 凍結に触れない）。(2) 将来、alert-ui に `animated?: boolean`（既定 true）を足す場合は PR に「推奨で決定」と書き、alert-contract-guard を通す。drive・PWA の実際の danger 点滅は安全上の通知なので対象外（ここでは触れない）。

## Warning（改善推奨）

- [brief-map.css:474-481, 483-485] role="switch" の OFF 状態のトラックが `--line`（#2C3C34）で、night の面（#0E1512）に対して約 1.6:1 | 基準: WCAG 1.4.11 Non-text Contrast（AA） | 状態自体は「つまみの位置」「ON/OFF の文字」「aria-checked」で伝わるので致命ではないが、OFF のときにスイッチの輪郭が見えにくい。修正: OFF のトラックに 3:1 以上の枠（例: `box-shadow: inset 0 0 0 2px var(--ink-faint)`。#7A8C84 は #0E1512 上で約 5:1）か、トラックを `--ink-faint` にする。
- [brief-map.css:342-355, ZoneMap.tsx:150-160] 凡例が地図の記号の全部を説明していない | 基準: WCAG 1.4.1 Use of Color の補足、1.4.11 | (a) 「ゾーン内は破線」の凡例が無い（ルートの実線/破線は地図の名札・通過一覧の文字で補われているので違反ではない）。破線の見本（短い SVG の線）を「ルート」「鹿ゾーン内（破線）」として足すと、色以外の手がかりが画面上で説明される。(b) 鹿多発ゾーンの見本 `alert-zone`（#E8A64A）は白い面の上で約 2.1:1。隣に文字があるので必須ではないが、`stroke: var(--ink)` の 1px 枠を足すと 3:1 を満たす（ZonePassageList の三角は ink の枠付きで良好）。
- [BriefPage.tsx:15-18, 27-37, useTripDay.ts:58-71] 日の切り替え（D1〜Dn）で、フォーカス・読み上げ・タイトルの扱いが日によって変わる | 基準: WCAG 2.4.3 Focus Order、4.1.3 Status Messages、2.4.2 | `staleTime: Infinity` のため、読み込み済みの日へ戻ると `BriefContent` は再マウントされず、`focusOnMount`（ref が同じ関数なので再実行されない）も動かない。キーボード・SR 利用者には「何も起きない」ように見える（`aria-current` の変化だけ）。一方、初めて開く日は loading の `<main>` に差し替わって再マウントされ、フォーカスが押したリンクから見出しへ飛び、ヘッダーの D2→D3 と続けて押せなくなる。修正案: 見出しに `key={day.day}` を付けるのではなく、日を変えたときだけ見出しへフォーカスする（`onClick` で `navigate` 後にフォーカス、または見出しの隣に `role="status"` の visually-hidden 文「DAY 2 を表示しました」）。方針をそろえるのが目的。
- [BriefPage.tsx:137 `<title>` ] ページタイトルが全ての日で同じ（「出発前チェック | EZO ROAD」）。loading・エラー画面には `<title>` が無い | 基準: WCAG 2.4.2 Page Titled（A、index.html のタイトルが残るなら違反ではない） | `DAY n` をタイトルに含める（例: 「DAY 2 ｜ 出発前チェック | EZO ROAD」）。エラー画面にも `<title>{message}</title>`。
- [BriefPage.tsx:29-33, 69-71] loading が `<main aria-busy="true"><p>` だけで、ライブリージョンではない。「もう一度」を押すとボタンが消えてフォーカスが body に落ちる | 基準: WCAG 4.1.3、2.4.3 | `aria-busy` は読み上げを起こさない。`<p role="status">` にする。再試行後の loading でも、エラー → loading → 結果の見出しフォーカスに戻るまでフォーカスが宙に浮く。loading の `<main>` に `tabIndex={-1}` でフォーカスを移す、または再試行ボタンを loading 中も残す（disabled にしない `aria-disabled`）。
- [ZoneMap.tsx:149-172] `<figcaption>` に凡例の一覧・注記・帰属リンクまで入っている | 基準: WCAG 1.3.1 / 4.1.2（名前の算出） | ブラウザによっては figure の名前が figcaption 全文になり、SR が figure に入った時点で長い名前を読む。`<figure aria-labelledby>` で SVG の短い見出しを指すか、凡例・帰属を figcaption の外（`<div>`）に出す。
- [ZoneMap.tsx:145-147] 地図の「読み込んでいます」は `<p>` のまま（ライブでない）。また `lines` が空で `bounds` が null の場合、`state.project` が来ず永遠に「読み込んでいます」になる | 基準: WCAG 4.1.3、3.3 | useBaseMap.ts:57 の `if (!element || !boundsKey) return` で確認済み（bounds が null だと effect が何もせず state は loading のまま）。通常の旅では起きにくい（停泊地が見つからない場合のみ）が、`role="status"` を付け、`bounds === null` のときは loading ではなく説明文を出す。

## Info

- 地図の SVG: `role="img"` ＋ `aria-label`（出発 → 到着 ＋ ゾーンの名前と通過時刻）は R9 と UC-9c のとおりで良好。ゾーン通過の一覧が同じ内容の文字の代替になっている。MapLibre は `interactive: false` で、キャンバスにキーボードの罠・フォーカス停止は無い。SVG は `pointer-events: none`。
- 色だけに頼らない: ルートは実線（ゾーン外）/破線（ゾーン内）、ゾーンは帯 ＋ 名札の文字 ＋ 通過一覧の三角と文字、3 状態は形（円・三角・八角）と文字。凡例のミニスマホは `aria-hidden` ＋ 同じ内容の文字（形・一言）で、SR でも二重読みにならない（AlertState の role="alert" / role="status" も aria-hidden の中なので読まれない）。
- 凡例のミニスマホの文字は 9 px × 0.4 で実寸約 3.6 px、読めない（仕様 R6 が「凡例の中だけ」と承認済み）。伝える内容は隣の 12 px の文字にあるので問題なし。ただし 200% 拡大しても `94 × 158 px` の枠は px 固定なので拡大に追従しない（ブラウザのズームは全体が拡大される）。
- スイッチの名前は `aria-label`（「鹿アラート」）で、見出し「鹿アラート（ダッシュボードのスマホ）」に含まれる（2.5.3 Label in Name 問題なし）。`aria-labelledby="brief-alert-title"` にすると見出しとの二重管理が無くなる。ON/OFF の文字は `aria-hidden` で、状態は `aria-checked` で伝わるので正しい。切り替え後の説明文（offNote / offActive）は `aria-describedby` で結ぶとさらに良い。
- ON 時のつまみ（ink #F2F5F1）と緑のトラック（#3FA98C）の差は約 2.6:1。トラックは面に対して約 6.4:1 で、位置と ON の文字で状態が分かるので問題なし。
- つまみの `transition: left 0.15s` は `prefers-reduced-motion` の対象外（動きが小さいので許容）。
- 日付リンクの `aria-current="page"` は現在の日の背景（spruce）で区別。色の明度差が約 6:1 あり色だけではない。ステッパーの `aria-current="step"` と、完了の段に visually-hidden の「（完了）」があるのは良い。英語の画面でも括弧が全角「（Done）」になる（細かい点）。
- ステッパー・凡例・チップの `list-style: none` は Safari / VoiceOver でリストの意味が外れる（`role="list"` を付けると保たれる）。
- loading と BriefError の `<main>` は日本語固定で `lang` 属性が無い。index.html が `lang="ja"` なら問題なし（3.1.1 は文書の lang で満たされる）。
- 帰属表示の OSM リンクは 44 px 未満だが、文中のインラインリンクは目標サイズの対象外（WCAG 2.5.5 は AAA、2.5.8 は 2.2）。指摘しないこと。
- 外部リンク（OSM の著作権）は `target="_blank"` で、新しいタブで開くことが示されていない（WCAG の必須ではない。`rel="noreferrer"` は付いている）。
- 要約行の「→」「・」は SR によって「右矢印」「中黒」と読まれることがある。要約が `brief-num`（等幅）で、日本語がフォールバック字体になる（見た目のみ）。
- 文字サイズは全て px のトークン。ブラウザのズームでは拡大するが、既定フォントサイズだけを変える設定には追従しない（プロジェクト全体の方針）。

## 確認できたもの（問題なし）

コントラストは tokens.css の値から計算した（約値）。

| 文字 / 部品                                  | 前景 / 背景                              | 比                   | 大きさ     | 判定                                   |
| -------------------------------------------- | ---------------------------------------- | -------------------- | ---------- | -------------------------------------- |
| ink-muted #4A5A53                            | ground #FBF8F1                           | 約 6.9:1             | 12-14 px   | 合格                                   |
| ink-muted                                    | surface #FFFFFF / surface-sunken #EEF0EA | 約 7.3 / 6.3:1       | 12-14 px   | 合格                                   |
| spruce #1E6F5C（完了の段、リンク、副ボタン） | ground / surface                         | 約 5.7 / 6.0:1       | 13-16 px   | 合格                                   |
| on-spruce #FFFFFF                            | spruce                                   | 約 6.0:1             | 13-16 px   | 合格（現在の段、現在の日、開始ボタン） |
| clay-deep #B34E14（地図の注記）              | ground / surface                         | 約 4.9 / 5.2:1       | 12 px      | 合格（ground 上は余裕が小さい）        |
| 名札の白 #FFFFFF                             | clay-deep                                | 約 5.2:1             | 13 px 太字 | 合格                                   |
| ink（地点名）＋ surface の縁取り             | 地図                                     | 縁取りで担保         | 13 px 太字 | 合格                                   |
| night: ink-muted #B9C6BF                     | night ground #0E1512                     | 約 10.5:1            | 12 px      | 合格                                   |
| night: ink                                   | night ground                             | 約 17:1              | 12-16 px   | 合格                                   |
| 見本の safe / zone / danger の文字           | 各背景                                   | 約 6.4 / 8.8 / 4.6:1 | 大きい太字 | 合格                                   |
| フォーカス枠 spruce 3 px                     | ground / night ground                    | 約 5.7 / 6.4:1       | -          | 合格                                   |

- 44 × 44 px: `.brief-day`（min 44 × 44）、`.brief-switch`（min 64 × 44、実高約 60）、`.brief-button`（44）、`.brief-start`（58）、`.brief-link`（44）は全て合格。
- 12 px 未満の文字: 実 UI には無い（最小は caption / eyebrow / num-s の 12 px）。例外は凡例のミニスマホ内のみ（上記 Info）。
- 構造: `header`（banner）、`nav`（aria-label）、`main`、`aside`、`section[aria-labelledby]`、見出しは h1 → h2 → h3 の順。`lang` は旅の言語（zh は zh-Hant）。Tab 順は 進み具合 → 日 → 地図の説明 → 通過一覧 → アラート → 条件 → 開始で、視覚の順と一致。
- エラー画面: h1 に `tabIndex={-1}` ＋ 自動フォーカス、続く操作（リンク / 再試行ボタン）が 44 px。メッセージが具体的で次の行動（A-1 へ、DAY 1 へ、もう一度）がある。
- 点滅: この画面の独自の点滅・自動で動くものは無い（Critical の凡例を除く）。

## 実機で確かめるもの（自動・読解では分からない）

1. VoiceOver / NVDA でスイッチが「鹿アラート、スイッチ、オン」と読まれるか。
2. 日の切り替え（読み込み済みと初回）のフォーカスと読み上げ。
3. 200% ズーム・幅 320 px で、地図の名札・通過一覧・ヘッダーが切れないか（名札幅は文字数の概算 `tagWidth`。ja で約 230 px の計算で 288 px 枠に収まる見込み）。
4. OpenFreeMap の実タイルの上で、地点名の縁取り・ルート線・帯が見分けられるか（背景色は tokens で塗り直す仕様だが、実描画は未確認）。

### スコア: 82/100

減点: Critical 1 件（-10）、Warning 7 件（-8）。
