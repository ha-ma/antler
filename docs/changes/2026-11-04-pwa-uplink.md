# 変更: PWA → edge の車の状態（pwa-uplink）

2026-11-04。ch7「B WebSocket」の原本は、クライアント → サーバーを `ack` と `label` だけにしている。
L1 の入力（JudgeRequest.state）を固定値から実値にするため、`ClientMessage` に `vehicle` を**追加**する。既存の型・検証は変えない。
原本（Claude Docs）が直るまで、この文書と `docs/specs/pwa-uplink/` が正。

```json
{ "type": "vehicle", "speedKmh": 42, "zone": "inside", "light": "dusk" }
```

- 3 項目はすべて任意。無い項目は「分からない」で、edge が固定値（60 km/h・inside・night）で埋める。`headlight` は常に `low`（PWA に分からない）
- 緯度経度・精度・時刻・端末の識別子の項目は無く、足すと拒否される（strict）。位置は PWA の端末の外に出ない
- 光の区分は PWA が `@antler/zones` の `lightPeriod` で決める（edge は位置を持たない）
- 新しさは edge が受け取った時刻で測る。10 秒（`[l1] vehicle_max_age_s`）で固定値に戻る
- `[l1] vehicle_state = "fixed"` で、実値を使わず従来の固定値に戻せる（校正のずれを疑うときの安全弁）
- 校正（`calibration.json`）は固定値の状態で学習したもの。実値での再学習は `dataset/export_l1_labels.py` の実値のモードで行う（pwa-uplink の Deferred）

決定は推奨案で行った（`docs/specs/pwa-uplink/functional.md` の「決着済み」）。
