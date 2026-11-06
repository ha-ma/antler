# 実装ロードマップ（feature の順番）

ch10-plan.md の 1 週間の計画に、付録 A（ch11-appendix-a.md）の改善リストを重ねた、`/sfad cycle` の順番。
**どの feature で何をするかの正はこのファイル**（要件そのものの正は docs/requirements/）。
背景（ビジネス・プレゼン・開発の全体像）は統合ドキュメント https://claude.ai/artifact/EWgkjzMEFsTKozahPeT4pg を参照する（文脈であって要件の正ではない）。

## 付録 A から実装に入るもの

付録 A の 15 項目のうち、コードや仕様に影響するもの。●は必須、○は時間があれば。

| 付録 A | 内容                                                                                                                                                   | 受け持つ feature                             | 影響                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 ●   | しおり（A-1）・イベント文と選択肢（A-4）・喪失文（A-6）を Claude が生成。4 言語同時。Skills で「道東観光知識」「鹿事故統計と注意喚起の書き方」を分ける | plan-trip、stop-events、loss                 | api に Claude API の Gateway（`application/ports/gateways/`）。`ANTHROPIC_API_KEY` を環境変数で必須にする（フォールバックなし）。シードで再生できるよう、生成結果を TripPlan と一緒に保存する |
| #2 ○   | B の二次確認を Claude Vision で（**2026-11-03 の変更指示で L2・任意に変更**。旧 B2-3 の VLM 二次確認は削除）                                           | edge-l2（任意）                              | 判断は L0（YOLO、赤はここだけ）/ L1（Mac mini 上の local-jev、非同期で降格だけ）/ L2（Claude Vision、回線があるときだけ）の 3 層。詳細は `docs/changes/2026-11-03-b-l1-local-jev.md`          |
| #4 ●   | ペルソナを 1 人に絞る（台湾から初めての北海道、4 人、2 月、流氷、レンタカー）                                                                          | plan-trip（A-1 の既定値）、alert-ui の zh-TW | A-1 の初期値をこの 1 人に揃える。zh-TW の文言のネイティブ確認（alert-ui の Deferred）の重要度が上がる                                                                                         |
| #7 ●   | 実走記録 1 本（B が鹿か写真板に反応した映像と p95 遅延ログ。反応しなかった記録も）                                                                     | edge-detector、edge-latency                  | 走行ログの `t_frame` / `t_sent` / `t_shown` を必ず残す（既定どおり）                                                                                                                          |
| #8 ●   | 鹿モデルと実写の比較画像を README に                                                                                                                   | deer-model（Day 3）、readme                  | ch9 ③ の判断（要確認のまま）が前提                                                                                                                                                            |
| #9 ●   | 「安心して使える」最低ライン 4 つ: B-0 が QR 1 回で終わる / Wi-Fi 切断で「未接続」/ A が登録なしで最後まで / 4 言語が全画面で欠けない                  | pwa-connect、pwa-drive、全画面の feature     | 各 feature の受け入れ基準に入れる。4 言語の欠けを機械で見つける検査（文言の表の空欄チェック）を i18n の共通の仕組みにする                                                                     |
| #10 ○  | A-7 と B の走行後の「今日の鹿レポート」を Claude が書く                                                                                                | record、edge-report                          | #1 の Gateway を使い回す                                                                                                                                                                      |
| #11 ○  | 鹿ゾーン DB と走行ログを MCP サーバーに                                                                                                                | zones-mcp                                    | Claude Code から「釧路方面の薄暮に多い区間は？」を問える                                                                                                                                      |
| #12 ○  | モデル使い分け表とハーネスの図を README とデモに                                                                                                       | readme                                       | CLAUDE.md の「エージェントチームの動かし方」が元                                                                                                                                              |
| #13 ○  | `docs/reports/` の試行錯誤を README からリンク                                                                                                         | readme                                       | エージェントの報告を `docs/reports/` に残す運用（既定どおり）                                                                                                                                 |
| #15 ○  | 3 状態を色＋形で分けた理由を README に 3 行                                                                                                            | readme                                       | —                                                                                                                                                                                             |

コードに影響しないもの（#3 デモ構成、#5 ハッカソン後の利用者、#6 4 つの壁、#14 エゾシカの大きさのカット）は、デモと応募文で扱う。
ただし #3 のデモの本体（75〜150 秒「A と B で同じ赤・同じ音」）が撮れることが Day 3 のゲートになる。

## feature の順番

人 A（sim 系統）と人 B（edge 系統）は並行して進める。1 feature ＝ 1 `/sfad cycle` ＝ 1 ブランチ・1 PR。

| Day | 人 A（apps/sim・packages・apps/api）                                                                | 人 B（edge/detector・apps/pwa・dataset）                                                                         | ゲート                                               |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | **alert-ui**（schema・AlertState・音・トークン。凍結）→ zones（鹿ゾーン GeoJSON）                   | edge-camera（取込・間引き・YOLOv8 CoreML の推論）                                                                | schema / alert-ui の API 凍結、第 9 章の判断         |
| 2   | plan-trip（A-1、Claude がしおり生成 #1、ペルソナの既定値 #4）→ brief-map（A-2）→ drive-3d の骨格    | pwa-connect（B-0・B-1、WebSocket、Wi-Fi AP、「未接続」#9）→ edge-judge（2 フレーム・1.5 秒・距離）               | PC で車が走る。スマホがフラグを受ける                |
| 3   | drive-3d（車両力学・鹿 5 パターン・A-5 の赤と音）                                                   | pwa-drive（B-2・B-3）→ schema-judge → edge-l0 → edge-l1 → edge-l1-calibration（L1 の判断、下の注）→ edge-latency | A-5 で赤が出て音が鳴る。B 実機で検知 → 通知 1 秒未満 |
| 4   | stop-events（A-4、Claude のイベント文 #1）→ loss（A-6、Claude の喪失文 #1）→ record（A-7）→ capture | 調査走行（実写・実走記録 #7）、検知フレームの保存                                                                | A が最初から最後まで通る                             |
| 5   | mobile-landscape・i18n の全画面確認（#9）・performance                                              | dataset（学習スクリプト）・閾値調整                                                                              | データループが 1 周                                  |
| 6   | readme（#8・#12・#13・#15）・CREDITS・ライセンス、○ deer-report（#10）、○ zones-mcp（#11）          | 振動・熱・再接続テスト                                                                                           | 受け入れ基準をすべて満たす                           |
| 7   | デモ動画（#3 の 3 分構成）                                                                          | デモ動画（実機）                                                                                                 | 提出                                                 |

## いまの feature（alert-ui）への影響

- #9「4 言語が全画面で欠けない」: AlertState の文言は 4 言語とも全状態ぶん埋めてある（UC-6b）。zh-TW と ko のネイティブ確認は Deferred のまま（期日 Day 5）
- #4 ペルソナは台湾から: 主文が zh になる経路（`resolveLang` が zh-TW → zh）は UC-6c で確かめる
- #3「同じ音」がデモの主役: チャイム・ビープの wav を A と B で同じファイルにする（plan.md #5 のとおり）

## 後の feature に持ち越す決まり（レビューから）

- **drive-3d**: `deriveAlertState` に渡す GPS 相当の判定は、最初のフレームから inside / outside を明示する。`unknown` を渡すと起動直後扱いで琥珀とチャイムが出る（alert-ui C-1、2026-11-03）
- **pwa-connect / pwa-drive**: 位置の許可が無い・GPS が取れない間は琥珀のまま緑にならない。B-0 で位置の許可を案内し、取れないことを画面で示す（`docs/reports/2026-11-03-alert-contract-guard-alert-ui-c1.md` W-2）
- **pwa-drive**: zones の `verifyZoneHash` で同梱した zones.geojson を起動時に照合する。誤差 100 m 超で inside のときの残り km の表示を決める（`docs/reports/2026-11-03-alert-contract-guard-zones.md` W-3）
- **zones（drive-3d のレビューから）**: `measureAlongRoute` に前回の位置を手がかりに渡すと、近くの線分の端（最短 + 30 m 以内）から手がかりに近いものを選ぶため、まっすぐな道でも位置が最大 30 m 遅れる（A は車の道のり s を手がかりに渡して回避済み）。あわせて `projectOnRoute` が毎回ルートの全線分を走査し、`Math.min(...配列)` で展開している（plan-trip の長いルートで遅く、十数万点でスタック超過）。手がかり ±300 m の窓とループへの置き換えを zones の担当で検討する。B も使うので「挙動は同じ・探す範囲だけ狭める」として PR に書く（`docs/reports/2026-11-03-alert-contract-guard-drive-3d.md`・`2026-11-03-performance-analyzer-drive-3d.md` W-1）
- **dataset（Day 5 の学習スクリプト）**: feature 名は `dataset-train`（`docs/specs/dataset-train/functional.md`、`dataset/train_l0.py`）。いまの素材で回るのは Commons の 29 枚だけ。写真のラベル付け（prelabel）、A の「見つけた」の Capture、閾値の調整は次の feature
- **performance（Day 5）**: drive-3d の 60 fps は開発機の M2 でしか測っていない。内蔵 GPU（dpr 1.5 で 2.9 MP）とスマホの 30 fps を実機で測る
- **drive（brief-map から）**: A-2 は `/drive?trip={id}&day={n}(&alert=off)` で渡す。drive が `GET /api/trips/:id/day/:n` の `DayPlan`（ルート・ゾーン区間・`conditions` の天候と路面）で走る形にし、条件の型は `@antler/trip` の `Weather`・`Surface` に差し替える。1 日の移動は 200〜450 km あるので、3D で走る範囲（ゾーン区間の前後など）を決める。A-2 中の `/drive` のチャンクの先読み（ch6）もここで（`docs/specs/brief-map/functional.md` の Deferred）
- **performance / api（brief-map の security M1）**: `GET /api/trips/:id/day/:n` は毎回ルートを計算する（ペルソナで数十 ms）。公開して負荷が気になったら、同じ旅・同じ日の結果の再利用か同時計算の上限を入れる（`docs/reports/2026-11-03-security-auditor-brief-map.md`）
- **地図の背景（Day 6）**: OpenFreeMap が止まったときの代わり（自前の PMTiles など）。いまは背景なしの表示に縮退する
- **loss（record から）**: 運転の終わりは app 層の `apps/sim/src/app/DriveRoute.tsx` が drive の `onFinish(DriveResult)` を受け、`toDriveRun` で走行の記録にして `useSaveRun` で残す（旅の場面だけ）。完走で残せたら `/t/:id` へ、衝突は残すが移らない（終了の帯のまま）。A-6 へ移すときは、この DriveRoute の衝突の分岐に足す（run の表や API を別に作らない。`not-owner` なら移らない）。`docs/specs/record/functional.md` R11
- **stop-events（record から）**: `DELETE /api/trips/:id`（record）は trips・trip_runs・trip_requests を 1 つのトランザクションで消す。出来事の表を足したら、`DrizzleRecordRepository.deleteTrip` に足す（`record-usecases.test.ts` の UC-5a が `trip_id` の列を持つ表の一覧を固定しているので、表を足すと落ちる。そこで削除にも足す）
- **deploy（record から）**: 本番の api は `PUBLIC_API_URL`・`SIM_PUBLIC_URL`・`PWA_PUBLIC_URL` を公開の URL にする（既定は開発の localhost）。Linux では OG 画像の日本語・中国語・韓国語のために `fonts-noto-cjk` を入れるか `OG_FONT_FILES` を書く
- **テスト（record から）**: `packages/*` のテストは npm test で回っていなかった。record で `packages/trip` に test の script を足した。`packages/schema`・`zones`・`alert-ui` も足すかは各担当で

## B の判断の 3 層化（2026-11-03 の変更指示）

`docs/changes/2026-11-03-b-l1-local-jev.md` の §4 の順に進める。要件の差分（ch4・ch7・ch10）は、原本の Claude Docs が直るまでこのファイルが正。

- Step 0（ユーザー、Mac mini 実機）: macOS 27.x、local-jev、ANE の fps と L1 の計測 → `docs/reports/2026-11-0X-day0-mac-mini.md`
- Step 1 schema-judge: `JudgeRequest`（TS・JSON Schema・pydantic）、`AlertFlag.l1`・`Capture.l1Probs`（任意の欄の追加だけ）
- Step 2 edge-l0: CoreML を Neural Engine に、トラッカー・距離・横速度・TTC（決定的なコード）。L1 無しで赤が従来どおり
- Step 3 edge-l1: typesafe-sdk のクライアント、4 問、fusion（校正後 0.9 以上のときだけ降格）。L1 は赤の経路に入れない
- Step 4 edge-l1-calibration: A のシミュレーションログから校正用のラベル、温度スケーリング
- Step 5（任意）edge-l2、Step 6 比較実験（結果は ch9 ④ の下に貼り、判断はユーザー）
