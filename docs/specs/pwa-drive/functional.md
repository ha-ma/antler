---
feature: pwa-drive
target_paths:
  - apps/pwa/src/features/connect/
  - apps/pwa/src/app/
spec_confirmed_at: 7a68248
tier: 1
---

# 仕様: pwa-drive（スマホの GPS × 鹿ゾーンで 3 状態を出す）

## 概要

pwa-connect の B-1 に、スマホの GPS（`watchPosition`）と `@antler/zones` の `judgeZone`・`toGpsZone` を足す。ゾーン内（琥珀、B-2）・ゾーン外（緑、B-1 の路線名と到達予定）を、Mac Mini（edge）が無くても出す（B4-5）。
同梱した `zones.geojson` は起動時に `verifyZoneHash` で照合する。位置が取れない間は琥珀のままで、取れないことを画面で示す。画面の常時点灯（Wake Lock）と回転ロックを試みる（B4-6）。
要件: ch4 B4-2・B4-3・B4-5・B4-6、ch5（3 状態表の遷移条件）、ch6（プライバシー: 精密な位置を保存しない）、ch7。持ち越し: roadmap「後の feature に持ち越す決まり」（pwa-connect / pwa-drive）と `docs/reports/2026-11-03-alert-contract-guard-zones.md` W-3。
前提: pwa-connect（PR #12、main）。`@antler/zones`・`@antler/alert-ui`・`@antler/schema` は変えない。

**範囲外**: manifest と Service Worker（https の配信元の判断を待つ。pwa-connect の Deferred）、B-3 の赤の実装そのもの（alert-ui と pwa-connect で済み。この feature は GPS の入力を足すだけ）、走行ログ・Capture、edge 側。

## Example Map

Story: ドライバーとして、Mac Mini が無くても、いま鹿ゾーンの中か・次のゾーンまで何 km かを見たい。位置が取れないときは、取れていないと分かりたい。

- R1: 位置の購読
  - B-1 を開いたとき `navigator.geolocation.watchPosition`（高精度・`maximumAge: 0`）を始め、B-1 を閉じたとき `clearWatch`。許可の状態が `denied` / 安全なコンテキストでない / Geolocation が無いときは購読しない
  - 測位は `{lon, lat, accuracyM, timestamp, speedMps}` の `Fix` に直す。`speed` が無い・NaN は undefined
  - 座標は画面・ログ・storage・ネットワークに出さない（精密な位置を保存しない。ch5）。判定の結果（状態・km・路線名・到達予定）だけ使う
  - エラーのコード（許可なし / 取得不可 / タイムアウト）だけをログに残す（座標なし）
- R2a（spec-adversary の指摘で決定）: 測位の鮮度は端末の測位の時刻（`position.timestamp`）でなく、**受け取った時刻**で数える（端末ごとの時計のずれで、凍った緑・固定の琥珀にならないように）
- R2b（同）: 位置が使えない（`judgeZone` が unknown。測位なし・10 秒より古い・誤差 1 km 超・北海道の外）あいだは、`deriveAlertState` に前の状態を渡さず（previous なし）、起動直後と同じ琥珀に倒す。緑や「ゾーンまで 3.2 km」を持ち越さない（緑のまま測位が途絶えて鹿ゾーンに入る見逃しが最悪の経路）。edge の新しいフラグが `zone:'outside'` と言うあいだだけ、緑を出せる
- R2c（同）: 判定の結果（`lastFix` に座標を含む）は React の state の中だけで使い、storage・ログ・ネットワーク・Query のキャッシュ・ack に載せない（docs/specs/pwa-uplink: 速度・ゾーンの内外・光の区分という派生値だけを `vehicle` として edge に返す。座標・精度・時刻は載せない）。ゾーン DB の Query は `staleTime: Infinity`（再取得しない）
- R2: 判定は `judgeZone`（zones の仕様どおり）。1 秒ごとの再計算で、10 秒より古い測位は unknown になり、測位が来なくなっても状態が止まらない
  - 前回の結果（`previous`）を渡し続ける。入るのは 150 m 以内、出るのは 200 m 超（ヒステリシス）
  - `toGpsZone` の結果を `deriveAlertState` の `gps` に渡す。アプリ側で状態を決めない
- R3: ゾーン DB の読み込みと照合
  - 起動時に同梱の `zones.geojson`（`ZONES_GEOJSON_URL`）を TanStack Query で取り、`verifyZoneHash` で照合し、`parseZoneCollection` で形を確かめる。1 つでも失敗したら、ゾーン DB を使わない（gps は unknown のまま。琥珀）
  - 読み込み・照合・形の失敗は画面に「鹿ゾーンのデータを読めません」と出す。再試行は 3 回まで（Query の既定の間隔）
  - 読み込み中は gps が unknown（琥珀）。画面に出さなくてよい（数秒）
- R4: 位置が取れないとき（roadmap の持ち越し）は琥珀のまま、理由を画面に出す
  - 許可なし・安全でないコンテキスト: 「位置情報なし」（pwa-connect のまま）
  - 許可はあるが、10 秒たっても測位が無い・測位が古くなった: 「位置を取得できません」。位置が戻れば消える
  - 緑は、位置が取れて outside と分かったとき（または edge のフラグが `zone:'outside'`）だけ出る（alert-ui C-1）
- R5: 誤差が大きいとき（zones W-3）
  - 誤差が 100 m を超えて inside と判定されたとき、残り km は出さない（「--」）。画面に「位置の誤差が大きい」を出す。琥珀は維持する（安全側）
  - 誤差が 100 m 以下に戻れば、残り km を出す
- R6: B-1（緑）に路線名と到達予定を出す（B4-2）
  - outside のとき、最寄りのゾーンの路線名（主文の言語）と、到達予定の時刻（JST の `HH:MM`。速さが 5 km/h 未満・無いときは出さない）を `AlertState` の面の外（上）に並べる。ゾーン内は路線名だけ
  - 面（色・形・数値・点滅）は変えない
- R7: 画面の常時点灯と回転ロック（B4-6）
  - B-1 を開いたとき Wake Lock（`navigator.wakeLock.request('screen')`）を取り、画面が見える状態に戻ったら取り直す。B-1 を閉じたら解放する
  - 取れない（API が無い・安全でない・拒否）ときは、「画面が消えることがあります」を画面に出す
  - `screen.orientation.lock('portrait')` を試みる。使えなくても落ちない（manifest の `orientation` が本筋で、pwa の配信元の判断のあと）
- R8: edge との併用
  - edge のフラグ（`zone`・`zoneRemainingKm`・`zoneDistanceKm`）と GPS が食い違うときの優先は `deriveAlertState` に任せる（どちらかが inside なら内側。GPS が距離の優先）
  - edge が無い（未接続）でも、GPS だけで緑・琥珀が出る。赤は出ない（B4-5）
- R9: 文言は 4 言語（辞書の空欄チェックに新しいキーを足す）。新しい注記: `gpsLost`・`poorAccuracy`・`zonesUnavailable`・`noWakeLock`、ラベル `etaLabel`

## ユースケース

### UC-1: 位置の購読（R1）

- **Given**: B-1 を開いた
- **When**: 測位が届く／エラーが届く／B-1 を閉じる
- **Then**: `Fix` に直して判定へ。座標を外に出さない。閉じたら `clearWatch`

### UC-2: ゾーン判定（R2・R8）

- **Given**: 測位とゾーン DB
- **When**: 測位が届く／1 秒ごと
- **Then**: inside は琥珀と残り km、outside は緑と次のゾーンまでの km。古い測位は unknown

### UC-3: ゾーン DB の照合（R3）

- **Given**: 同梱の zones.geojson
- **When**: 起動
- **Then**: 照合に通れば使う。通らなければ使わず、画面に出す

### UC-4: 位置が取れない・誤差が大きい（R4・R5）

- **Given**: 許可なし／測位なし／誤差 100 m 超
- **When**: B-1 を表示
- **Then**: 琥珀のまま、理由を出す。誤差が大きい inside は残り km を出さない

### UC-5: 路線名と到達予定（R6）

- **Given**: outside で測位に速さがある
- **When**: B-1
- **Then**: 路線名と HH:MM を面の上に出す

### UC-6: Wake Lock と回転ロック（R7）

- **Given**: B-1
- **When**: 開く／画面が戻る／閉じる
- **Then**: 取る／取り直す／解放。取れなければ注記

## 状態パターン

- S-1: 起動直後（位置なし・DB 読み込み中）→ 琥珀、距離「--」
- S-2: GPS で outside → 緑、距離 km、路線名（と到達予定）
- S-3: GPS で inside → 琥珀、残り km、路線名
- S-4: 許可なし → 琥珀、「位置情報なし」
- S-5: 測位が途絶 → 琥珀（前の状態を保つ）、「位置を取得できません」
- S-6: ゾーン DB が不正 → 琥珀、「鹿ゾーンのデータを読めません」
- S-7: 未接続・位置あり → 緑か琥珀（赤なし）＋「未接続」帯

## Questions（Deferred のみ残存可）

推奨で決定（CLAUDE.md の方針、2026-11-03）:

- 誤差が 100 m 超の inside は残り km を出さない・琥珀を維持 → 推奨で決定
- 位置の取得は高精度・`maximumAge: 0`、タイムアウトは設けない（途絶は 10 秒で古いとみなす）→ 推奨で決定
- ゾーン DB の失敗時は使わない（部分的に使わない）→ 推奨で決定
- manifest・Service Worker はこの feature に入れない → 推奨で決定

- pwa-connect の UC-4d「切断しても最後の inside / outside を保つ」は、GPS が使えないとき edge のフラグが古くなる 5 秒で琥珀に倒す（R2b）。pwa-connect のテストをこの feature で直した → 推奨で決定
- 誤差が大きい inside の残り km は「--」にする。edge のフラグが新しく `zoneRemainingKm` を持つときは `deriveAlertState` がそれを使う → 推奨で決定

保留:

- [Deferred: 担当=ユーザー（デモの場所）/ 期日=2026-11-06 / 暫定挙動=北海道の外では判定が使えず、琥珀のまま「位置を取得できません」。東京などでのデモ・開発では、位置の偽装か偽 edge のフラグで確かめる] 北海道の外での表示
- [Deferred: 担当=人 B（edge の feature）とユーザー / 期日=2026-11-05 / 暫定挙動=http で配る間は Geolocation が使えず、B-1 は「位置情報なし」の琥珀のまま。判定ロジックは localhost・https で確かめる] PWA の配信元の安全なコンテキスト（pwa-connect の保留と同じ。解決するまで実機の GPS 判定は動かない）

## Test List（Canon TDD Step 1）

UC-1:

- [x] UC-1a: B-1 を開くと watchPosition を高精度・maximumAge 0 で呼び、閉じると clearWatch
- [x] UC-1b: 許可が denied・安全でない・Geolocation なしなら購読しない
- [x] UC-1c: 測位を Fix に直す（speed が無い・NaN は undefined、accuracy は m）
- [x] UC-1d: 座標をログ・画面・storage に出さない（エラーはコードだけ）

UC-2:

- [x] UC-2a: ゾーンの中心線上の測位 → 琥珀（inside）で残り km
- [x] UC-2b: ゾーンから 10 km 離れた測位 → 緑（outside）で次のゾーンまでの km
- [x] UC-2c: 10 秒より古い測位は unknown になり、1 秒ごとの再計算で前の状態を保つ
- [x] UC-2d: 外からは 150 m 以内で入る（180 m は緑）。中に入ったあとは 200 m まで出ない（境界の数値は zones 側のテストが持つ）
- [x] UC-2g: [ADDED spec-adversary] 測位の時刻は受け取った時刻（端末の測位の時刻に左右されない）
- [x] UC-2e: GPS が outside でも edge のフラグが inside なら琥珀（どちらかが inside なら内側）
- [x] UC-2f: 未接続でも GPS だけで緑・琥珀が出て、赤は出ない

UC-3:

- [x] UC-3a: 同梱の zones.geojson が verifyZoneHash を通り、読み込まれる
- [x] UC-3b: ハッシュが合わない・形が違う・fetch が失敗 → 使わず、「鹿ゾーンのデータを読めません」
- [x] UC-3c: 読み込み中は gps unknown（琥珀）

UC-4:

- [x] UC-4a: 許可なし → 琥珀のまま「位置情報なし」
- [x] UC-4b: 許可ありで測位が 10 秒たっても無い・古くなった → 「位置を取得できません」。測位が戻れば消える
- [x] UC-4c: 誤差 100 m 超の inside → 残り km は「--」、「位置の誤差が大きい」。100 m 以下に戻れば km が出る
- [x] UC-4d: 位置が取れない間、緑にならない（起動直後・途絶とも）
- [x] UC-4e: [ADDED spec-adversary] 緑（outside）のあとに測位が 10 秒途絶えたら、緑と距離を持ち越さず琥珀（距離「--」）。測位が戻れば緑
- [x] UC-4f: [ADDED spec-adversary] 北海道の外（東京など）の測位は使えず、琥珀のまま「位置を取得できません」

UC-5:

- [x] UC-5a: outside で速さが 5 km/h 以上 → 路線名（主文の言語）と HH:MM（JST）
- [x] UC-5b: 速さが無い・5 km/h 未満 → 路線名のみ
- [x] UC-5c: inside → 路線名のみ。面（色・形）は変わらない

UC-6:

- [x] UC-6a: B-1 を開くと Wake Lock を取り、見えるようになったら取り直し、閉じたら解放
- [x] UC-6b: Wake Lock が取れなければ「画面が消えることがあります」
- [x] UC-6c: orientation.lock('portrait') を試み、使えなくても落ちない
- [x] UC-6d: 新しい文言（gpsLost・poorAccuracy・zonesUnavailable・noWakeLock・etaLabel）が 4 言語で空でない

受け入れテスト:

- [x] AC-1: 実在のゾーン（国道 12 号 神居古潭）の外から中へ測位を流すと、緑 → 琥珀、中から出ると緑に戻る。Mac Mini なし（WebSocket なし）で動く
- [x] AC-2: 同じ画面で、測位が途絶えると琥珀のまま「位置を取得できません」、戻ると消える

## 非機能要件

- [x] プライバシー: 座標を保存・送信・ログに出さない（ch5・ch6）
- [x] 電池・負荷: 判定は 1 秒ごと・測位ごとの 2 回。ゾーン 17 件の線形探索で足りる（B 遅延の描画 ≤ 50 ms に影響しない）
- [x] アクセシビリティ・色・絵文字: pwa-connect と同じ（注記はライブリージョン、色はトークンのみ）
- [x] 依存パッケージを増やさない

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC / 全状態パターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型）
- [x] alert-contract-guard の Critical が 0
