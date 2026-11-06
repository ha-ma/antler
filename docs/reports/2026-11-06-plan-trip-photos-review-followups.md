# plan-trip-photos のレビュー: 直したものと次に回すもの（2026-11-06）

レビュー 4 種はすべて Critical 0。全文は同じ日付の各レポート（component-guard・accessibility・code-reviewer・security）。

## このブランチで直したもの

- 取得のスクリプトが 1 件でも失敗したら、画像も記録も書き換えない（code-reviewer W3・security W2。画像と記録を 1 対 1 に保つ）
- 存在しないファイル名が 1 つあっても全体の解析が落ちない（imageinfo を任意に。code-reviewer W4）
- 高さの上限 1600px を記録の検証とスクリプトに足した（security W3）
- タッチの端末では引用のリンクの押せる面を 44px に（accessibility W1、ch8 の規約）
- CREDITS.md の表のセルに入れる作品名・撮影者の `|` を逃がす（security Info）

## 次に回すもの（Warning）

| 出所             | 内容                                                                                                        | 次の一手                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| code-reviewer W1 | 旧 weight で保存した旅で、`days` が偶然同じなら作り直しの例外にならず、stop-events が旧 weight で滞在を作る | brief-map の `buildDayPlan` で `plan.pleasures[].weight` と `weightForHours(hours)` の一致も確かめる（brief-map の担当） |
| code-reviewer W2 | stop-events の `MINUTES_PER_WEIGHT = 96` と `HOURS_PER_WEIGHT = 1.6` が二重定義                             | stop-events の rules で `HOURS_PER_WEIGHT * 60` を使うか、両者を結ぶテストを足す（stop-events の担当）                   |
| code-reviewer W5 | `review`（目視した）を全写真に無条件で書く                                                                  | photo-picks.json に確認した人・日を持たせ、スクリプトはそれを写す                                                        |
| code-reviewer W6 | 所要の長い順の比較が 3 か所に複製。itinerary が plan から換算関数を import                                  | `packages/trip/src/duration.ts` に `activityHours`・`weightForHours`・比較をまとめる                                     |
| security W1      | JPEG のメタデータの除去が拒否リスト方式（APP1・APP13 だけ）                                                 | 許可リスト方式（APP0・APP2・DQT・SOF・DHT・SOS 以外を落とす）に。いまの 24 枚は APP2 だけが残ることを実測済み            |
| security W4      | Retry-After の待ち時間と API 応答の受信サイズに上限が無い                                                   | 待ちを 60 秒で頭打ちに、API の応答も readCapped で読む（開発時だけのスクリプト）                                         |
| accessibility W2 | フォーカスリングが写真の上で 3:1 を割ることがある                                                           | 白い内側を足した二重リング                                                                                               |
| accessibility W3 | 「新しいタブで開く」が読み上げ名でだけ伝わる                                                                | 外部リンクのアイコン（インライン SVG）を足す                                                                             |
| accessibility W4 | カードごとにタブ停止が 3 つ                                                                                 | 楽しみの一覧をとばすスキップリンク                                                                                       |
| spec-adversary 6 | stop-events のモーダルと loss に「重さ」の表示が残る                                                        | 時間の表示に言い換えるか消す（plan-trip-photos の Deferred）                                                             |
