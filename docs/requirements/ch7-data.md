## 7. データモデルと API

> 出典: Claude Docs「EZO ROAD システム要件定義書 v1」https://claude.ai/artifact/Jr6zYHcjdSy5xEd1WaG7v8 （2026-11-03 エクスポート）。本文は原文のまま。変更は原文側で行い、再エクスポートする。


すべて JSON。時刻は ISO 8601（JST）。ID は短いランダム文字列。下のスキーマは第 9 章の判断で変わらない。

```json
// TripPlan — A-1 で生成され、記録に残る「旅のしおり」
{
  "id": "K7m2", "lang": "ja", "seed": 918273,
  "party": {"size": 4, "drivers": 2, "experience": "first"},
  "depart": {"at": "2027-02-14T10:00+09:00", "place": "CTS"},
  "return": {"at": "2027-02-18T17:00+09:00", "place": "CTS"},
  "budgetPerPersonJPY": 120000,
  "area": "doto",
  "pleasures": [ {"id": "drift-ice-walk", "weight": 5}, {"id": "red-crowned-crane", "weight": 4} ],
  "title": "流氷とタンチョウと、雪見の温泉。道東をめぐる5日間。",
  "days": [ {"day": 1, "from": "CTS", "to": "kushiro", "stops": ["washo-market"], "stay": "kushiro"} ],
  "riskScore": 0.78,
  "alertEnabled": true
}
```

```json
// AlertFlag — B が WebSocket で送り、A がゲーム内で合成する共通メッセージ（フラグ変化時と 1 Hz）
{
  "type": "flag", "v": 1,
  "deer": true, "conf": 0.94, "distanceM": 58, "side": "L",
  "zone": "inside",            // outside | inside
  "zoneRemainingKm": 14.2,     // outside のときは zoneDistanceKm
  "t_frame": "2027-02-15T16:31:08.120+09:00", "t_sent": "...08.310+09:00",
  "frameJpegB64": null         // 検知時のみ 320px JPEG（SHOULD）
}
```

```json
// Capture — A の「見つけた」と B の検知フレームが共有する教師データスキーマ
{
  "id": "cap_8f3a", "source": "sim",            // sim | vehicle
  "image": "captures/cap_8f3a.jpg", "imageSize": [1280, 720],
  "boxes": [ {"label": "deer", "xywh": [0.31, 0.49, 0.10, 0.14], "by": "user"} ],  // by: user | model
  "conditions": {"season": "winter", "month": 2, "weather": "light_snow", "surface": "packed_snow",
                  "light": "dusk", "fog": "medium", "traffic": "low", "vehicle": "compact_suv"},
  "distanceM": 58, "side": "L", "pose": "standing",
  "reactionMs": 1200, "outcome": "avoided",      // avoided | collided | missed
  "roadSegment": "R241-akan-32", "consent": true, "createdAt": "..."
}
```

**A API（REST）**

| メソッド | パス | 役割 |
| --- | --- | --- |
| POST | `/api/trips` | 入力→TripPlan 生成（しおり・リスクスコア） |
| GET | `/api/trips/{id}/day/{n}` | その日のルート・ゾーン・イベント案（シードで再現可能） |
| POST | `/api/trips/{id}/events` | 選択・遭遇・衝突・回避のイベントログ |
| POST | `/api/captures` | Capture（画像は multipart） |
| GET | `/t/{id}` | 記録ページ（SSR、OG 画像） |
| GET | `/api/zones.geojson` | 鹿ゾーンDB（A/B 共通、プロパティに月・時刻別重み） |

**B WebSocket**：`ws://ezoroad.local:8765/alerts`。サーバー→クライアントのみ AlertFlag。クライアント→サーバーは `{"type":"ack","t_shown":...}` と `{"type":"label","value":"present|absent"}`（MAY）。
