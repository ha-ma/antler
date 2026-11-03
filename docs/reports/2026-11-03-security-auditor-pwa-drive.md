# セキュリティ監査: pwa-drive（apps/pwa/src/features/connect）

対象: lib/gps.ts, hooks/use-gps-zone.ts, lib/zones-loader.ts, lib/wake-lock.ts（関連: hooks/use-zones.ts, components/DriveScreen.tsx, services.ts, shared/utils/logger.ts, packages/zones/src/data.ts）
ブランチ: feat/pwa-drive。コードは変更していない。

## Critical

なし。

## High

なし。

## Medium

- [packages/zones/src/data.ts:21-29 / lib/zones-loader.ts:16] verifyZoneHash は「ファイル自身の hash と features の sha256 の一致」しか見ない（CWE-345）。
  - 影響: 期待値をコード側に固定していないので、ファイルを差し替える側が hash も計算し直せば検証を通る。偶発的な破損や手編集は検知できるが、改ざんは検知できない。features が空配列でも、hash を `sha256("[]")` にすれば通る。そのときゾーン判定は常にゾーン外になり、緑（安全側に見える表示）になる可能性がある（judgeZone の空コレクションの扱いは未検証）。
  - 緩和要因: 配信元が同一オリジンなので、ファイルを差し替えられる攻撃者は JS も差し替えられる。現状の脅威は改ざんより破損・A/B のファイル不一致が主。
  - 修正: (1) ビルド時に hash を定数として埋め込み（Vite define など）、ロード時に `value.hash === 期待値` も確かめる。または (2) loader で features が 0 件なら拒否する。(3) 余裕があれば `version` / `factorSource` も hash の対象に含める（現状は hash の対象外で、差し替えても検知されない）。

## Low / Info

- [lib/zones-loader.ts:20-23] 迂回経路の確認結果。`loadBundledZones` は `verifyZoneHash` を必ず通り、失敗時は例外で `parseZoneCollection` に進まない。`services.ts:24` 以外に `ZONES_GEOJSON_URL` の直接 fetch や `parseZoneCollection` 単独の呼び出しは無い（grep 済み）。迂回は見つからなかった。hash の検証対象（`JSON.parse` した value）と parse する対象は同一オブジェクトで、検証後に差し替わる隙は無い。ただし `loadBundledZones(fetchText, url)` の引数で任意の取得元・URL を渡せる。本番の呼び出しは引数なしなので問題ないが、将来 `?zones=` のような外部入力を url に渡すと検証が信頼の根にならなくなる点に注意。
- [packages/zones/src/data.ts:3-5] コメントは「Service Worker でキャッシュする」だが、apps/pwa に Service Worker と vite-plugin-pwa は無い（grep 済み）。いまはオフラインで DB が読めない。SW を入れるときは、キャッシュから読んだ場合も `loadBundledZones` を通すこと（通っていれば検証は有効）。
- [hooks/use-gps-zone.ts:88] 戻り値の `judgement` に `lastFix`（生の緯度経度）が入ったまま DriveScreen まで渡る。DriveScreen は roadName と eta だけを使っており、いまは外に出ていない。将来 `logger.warn('x', { judgement })` のように渡す変更が入ると座標がログに出る。修正案: フックの戻り値は表示に要る項目（status、roadName、eta）だけに絞る。lastFix は内部の state（previous）に留める。
- [shared/utils/logger.ts:9-14,32-37] `logger.error` は `error.message` と `stack` をそのまま出す。`window.error` / `unhandledrejection` の全捕捉もある。GPS まわりの例外のメッセージに座標を埋め込むコードは現状無い。今後 `throw new Error(\`bad fix ${lat},${lon}\`)` のような書き方をしないこと。ESLint などで禁止するのが望ましい。

## 観点別の結果

### 位置情報のプライバシー（座標が出るか）

| 出口                                                 | 結果                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| storage（localStorage / sessionStorage / IndexedDB） | apps/pwa/src に使用なし（grep 済み）。問題なし                                                                                                 |
| ログ                                                 | gps.ts は `{ code }` のみ記録（`e.message` は出さない）。wake-lock.ts は空フィールド。問題なし                                                 |
| ネットワーク                                         | WebSocket で送るのは ack のみ（edge-client.ts:94-108）。座標なし。CSP の connect-src は `'self'` と `ws://ezoroad.local:8765` に限定。問題なし |
| Query キャッシュ                                     | QueryClient に入るのはキー `['zones']` のゾーン DB のみ（永続化プラグイン・devtools なし）。座標は React の state だけ。問題なし               |
| 保持                                                 | `toFix` は端末の測位時刻を捨てて受信時刻を使う。state に残るのは最新の fix と previous.lastFix の 2 点だけで、履歴は積まない。問題なし         |

### ログの内容

- gps.error は `code`（数値）か `'throw'`。wakelock.failed / orientation.failed は空。機密なし。
- zones 読み込み失敗は useQuery が握り、logger には出ない。画面の注記（zonesUnavailable）のみ。例外メッセージは固定文言か HTTP ステータスで、座標を含まない。

## 総合評価

- リスクレベル: Low（Medium 1 件。プライバシーの観点では指摘なし）
- 推奨アクション: (1) ゾーン DB の期待ハッシュをビルド時に固定し、0 件の features を拒否する。(2) フックの戻り値から lastFix を外す。(3) SW を入れる cycle で、キャッシュ経由でも loadBundledZones を通すことを受け入れ条件にする。いずれも凍結 API には触れない。
