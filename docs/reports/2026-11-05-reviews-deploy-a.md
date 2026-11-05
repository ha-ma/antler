# レビューのまとめ: deploy-a（Vercel・Turso・Vercel Blob）

対象: ブランチ `feat/deploy-a`。仕様は `docs/specs/deploy-a/`。全文の報告:

- security-auditor: `docs/reports/2026-11-05-security-auditor-deploy-a.md`（Critical 0 / Warning 5）
- code-reviewer: `docs/reports/2026-11-05-code-reviewer-deploy-a.md`（Critical 1 / Warning 9）
- spec-adversary（読み取り専用なので要約をここに残す）・layer-guard（同じ）は下

## spec-adversary（仕様のドラフト。Critical 0 / Warning 5）

| 指摘                                                                  | 対応                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| W1 行の INSERT が失敗し続けると画像だけが Blob に増え、上限が効かない | 直した: 行を pending で先に取り、画像、done の順（R9）。CAP-6g                      |
| W2 古い版の DB に新しいコードが出ると、数えが落ちたまま上限なしで通る | 直した: 組み立てで版を確かめ、古ければ全部 503（R3）。VH-1d                         |
| W3 Turso が固まると fetch が時間切れしない                            | 直した: HTTP は 10 秒、数えは 2 秒（R5・R7）。DB-3a・RL-4h                          |
| W4 レート制限の書き込みの量（429 も 1 書き込み）                      | 直した: 上限を超えた鍵はメモリで 429（R7）。RL-4i。Firewall は手順書                |
| W Preview の URL は推測できる・本物のキー                             | 直した: Deployment Protection を必須、Anthropic のキーを分ける（threat.md・手順書） |
| Info 作った順の番号の scope は混ざる                                  | 直した: `rateLimit` の名前を必須に（RL-4c）                                         |
| Info プライバシーの文言の言い過ぎ                                     | 直した: threat.md の Data Classification                                            |

## layer-guard（api の層。Critical 1 → 再チェックで 0）

| 指摘                                                                                 | 対応                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical: Repository（BlobCaptureRepository）が Gateway（CaptureImageGateway）を呼ぶ | 直した: 画像の置き場所は Capture の永続化の一部（FileCaptureRepository の fs と同じ）として、Repository の実装の中の `CaptureImageStore`（`infrastructure/repositories/vercel-blob-image-store.ts`）にした。port・UseCase は変えない。再チェックで解消と判定 |
| W: 古い pending の判断が Repository にある                                           | 直した: `domain/captures/policies/capture-claim-policy.ts`・`rules/capture-rules.ts`（90 秒）                                                                                                                                                                |
| W: 503 の応答が入口に直書き                                                          | 直した: `infrastructure/http/unavailable.ts`                                                                                                                                                                                                                 |
| W（再チェック）: 手順の順序が Repository にある                                      | 残す: 永続化の原子性の手順で、FileCaptureRepository と同じ種類。業務の方針（Blob の再試行など）が増えたら UseCase に出す                                                                                                                                     |

## security-auditor（Critical 0 / Warning 5）

| 指摘                                               | 対応                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| W1 `/health/ready` は誰でも呼べ、毎回 Turso を読む | 手順書の Firewall の段に `/health/ready` を足した。コードは変えない                                                        |
| W2 Turso に届かないとき上限なしで通る              | 直した: インスタンスのメモリで数える（RL-4d・FAIL-1）                                                                      |
| W3 IP が取れないと全員が 1 つの枠                  | 直した: `client_ip.missing` を warn（1 分に 1 回）。手順書に書いた                                                         |
| W4 Turso のトークンが期限なし                      | 手順書に、使い終えたら `.env.turso-*` を消す・デモのあとで作り直す、を足した。期限は付けない（切れると本番が黙って止まる） |
| W5 bundle に sourcemap                             | 直した: `sourcemap: false`                                                                                                 |

## code-reviewer（Critical 1 / Warning 9）

| 指摘                                                                          | 対応                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 `@antler/zones/zones.geojson` が関数に入る保証が無い                       | 確かめた: 手元の `vercel build`（Vercel CLI 59.15.1、架空の project.json）の出力に `packages/zones/data/zones.geojson` が入り、`filePathMap` で `node_modules/@antler/zones` に写る。出力の関数のフォルダだけで `require.resolve` と resvg が動いた。Warning に下げる。実際のデプロイでも手順書の確かめ（`/health` が 200）で分かる |
| W1 done にできなかった直後 90 秒以内の再送が 200 になり、行が done にならない | 残す（仕様に書いた）: 窓を 10 分から 90 秒に縮めた。未完成を 503 で返すには `ExistingCapture` と edge-capture の契約を変える。別 feature                                                                                                                                                                                            |
| W2 done の UPDATE の結果を見ていない                                          | 直した: 0 行なら例外（CAP-6h）                                                                                                                                                                                                                                                                                                      |
| W3 取れなかったのに行が無いと 409                                             | 直した: 例外（再送で直る。CAP-6b）                                                                                                                                                                                                                                                                                                  |
| W4 同時の同じ id のテストが無い                                               | 直した: CAP-6b に足した                                                                                                                                                                                                                                                                                                             |
| W5 AC-1 の「ネイティブの libsql が実行の経路に無い」                          | 入口の bundle が `@libsql/client`（Node）と `libsql` を静的に import しないこと、ローカルの部品が動的 import の先であることを確かめている。加えて、手元の `vercel build` の関数で既定の入口を読み込めた                                                                                                                             |
| W6 動的 import の先の libsql も関数に入る                                     | そのまま: 入るが実行されない（手元の `vercel build` で、関数のフォルダだけで入口を読み込めた）                                                                                                                                                                                                                                      |
| W7 `--env-file` がシェルの値に負ける                                          | 直した: ファイルの値が勝つ（MIG-3d）                                                                                                                                                                                                                                                                                                |
| W8 分の境目でテストが落ちうる                                                 | 直した: Date を止める                                                                                                                                                                                                                                                                                                               |
| W9 名前の検査の正規表現                                                       | 直した                                                                                                                                                                                                                                                                                                                              |

## 手元の `vercel build` で確かめたこと

- `apps/sim/vercel.json` と `npm run build:vercel` で、静的（`dist`）と関数 `api/index.mjs` ができる。書き換えは `config.json` の routes に順に入る（`/t/:id` は `missing` の `app` つき）
- 関数のファイル: `apps/sim/api/index.mjs`・`apps/api/dist/vercel/handler.mjs`・`local-platform-*.mjs`・`packages/zones/data/zones.geojson`・`node_modules`（hono・drizzle・@libsql・@resvg・@vercel/blob など）。15 MB
- 関数のフォルダだけ（外の node_modules なし）で入口を import し `/health` を呼べた（Turso の代わりに閉じたポートを指したので 503。組み立ての前の読み込みとネイティブの resvg は通った）
- 手元は macOS（arm64）なので、Linux の関数（x64）のネイティブは実際のデプロイでしか確かめられない（手順書 7）
