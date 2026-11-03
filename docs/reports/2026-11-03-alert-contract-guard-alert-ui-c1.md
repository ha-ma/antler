# レビュー結果: alert-contract-guard × alert-ui C-1（起動直後の unknown → zone）

alert-contract-guard（読み取り専用）の結果を、メインセッションが書き写したもの。Critical 0 / Warning 2 / Info 2。

変更: `deriveAlertState` の `resolveInZone` で、GPS もフラグも内外が分からず前の状態も無いときに `inZone: true`（琥珀・距離「--」）を返す。2026-11-03 のユーザー判断「琥珀にする」。型・公開 API は変えていない。

## Critical

- なし。danger の分岐（`fresh?.deer`）は変わらず、`inZone` だけが変わる。

## Warning

- **W-1（対応済み）** 起動直後の zone でチャイムが鳴る（`sound-controller.ts` の `applyZone`。`zoneAnnounced=false`・`leftZoneAt=null` なので鳴る）。位置不明で琥珀を出すので鳴らすのが妥当（ch5 の「進入時」に当たる）。UC-5j で「1 回鳴り、不明の間・safe に戻っても鳴らない」を固定した。
- **W-2（次に回す: pwa の feature）** GPS の拒否が続くと緑が出ない。PWA に「位置が取れない」ことを示す導線（B-0 の許可案内など）が要る。

## Info

- A（sim）は inside / outside を常に渡す想定なので影響なし。ただし最初のフレームで `unknown` を渡すと、1 フレームだけ琥珀とチャイムが出る。**drive-3d の Test List に「初期値は outside か inside を明示する」を入れる。**
- 起動直後に danger になった場合、解除後は `inZone: true` から zone に戻る（緑に飛ばない）。
