# 変更の記録: Capture.boxes[].xywh は左上基準（2026-11-04、edge-capture）

`packages/schema` の `Capture`（凍結）は `xywh` を「画像に対する割合（0〜1）の x, y, 幅, 高さ」としか書いていない。edge-camera の Deferred（`Detection.xywh` は YOLO の中心基準）を回収するため、次のとおり決めた（推奨で決定）。

- **Capture の `xywh` は左上基準**: `[x, y, 幅, 高さ]`。x・y は箱の左上。すべて 0〜1。画像の外にはみ出す部分は切る
- **edge** は YOLO の中心基準 `(cx, cy, w, h)` を `x = cx − w/2`、`y = cy − h/2` に直し、画像の中に切って書く（`edge/detector/src/detector/capture/model.py` の `_box`）
- **A の「見つけた」（sim）** は、利用者がドラッグで囲んだ箱の左上と幅・高さをそのまま書く。中心基準に直さない
- `packages/schema` は変えていない（コメントの追記も凍結のため見送り）。この記録と `docs/specs/edge-capture/functional.md` E1 が正
- fixture（`packages/schema/fixtures/capture/valid/`）の `xywh: [0.31, 0.49, 0.1, 0.14]` は左上基準として読んで矛盾しない

確認: alert-contract-guard W-4（A の担当が基準を知る手がかりが B の spec しかない）への対応。
