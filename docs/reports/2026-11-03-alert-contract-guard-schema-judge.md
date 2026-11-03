# alert-contract-guard: schema-judge（2026-11-03）

**Critical 0** / Warning 2 / Info 4。対象: `6116484..f08f323`（読み取り専用のエージェントが返答で報告。メインセッションが転記）。

- 凍結 API: 既存の欄・型・条件・export は消えていない。AlertFlag の 4 通りの union と `t_frame` / `t_sent` の必須は維持。Capture の `required` は 14 個のままで、`l1` と `l1Probs` は任意。
- プライバシー: `l1` / `l1Probs` は列挙と 0〜1 の数値だけの strict で、位置・識別子・自由文を運べない。`consent` と `isUploadable` は変わらない。
- JudgeRequest: `state` は strict（画像・lat・lng・deviceId は拒否）。質問は 4 問を文言・順序・`options` まで literal の tuple で固定。
- 3 つの形: `judge-request.schema.json` と `judge_request.py` を突き合わせ、必須キー・範囲・パターン・質問文が一致。

| ID  | 重さ    | 指摘                                                                                                                                          | 対応                                                                                                                       |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| W-1 | Warning | `readAlertFlag` の変更は新しい PWA にだけ効く。旧バンドル（service worker のキャッシュ）の PWA は `l1` つきの deer:false を捨てて赤が解けない | PR に書く。**edge-l1 が `l1` を送り始めるのは、この変更を含む PWA を配った後にする**（`docs/roadmap.md` の Step 3 の前提） |
| W-2 | Warning | `strict` の意味がずれた（`l1` を除いた判定）。コメントが古い。壊れた `l1` は PWA で `problem` も出ない                                        | コメントを直した。edge-l1 は送る前に `AlertFlagSchema` で自己検証する（PR に書く）                                         |
| I-1 | Info    | `model`（ASCII 64 字）・`pos`（32 字）は識別子を紛れ込ませる余地がある。宛先は 127.0.0.1                                                      | edge-l1 でログと保存に出さないことを確かめる                                                                               |
| I-2 | Info    | main の checkout に `trip-details` がある。`index.ts`・`json-schema.ts` が衝突する。UC-5a の `toHaveLength(5)` は 6 に直す必要があった        | 両方の export を残して解く。UC-5a の件数固定をやめた                                                                       |
| I-3 | Info    | `JUDGE_QUESTIONS` は実行時に書き換えられる                                                                                                    | 受け入れる（利用側は読むだけ）                                                                                             |
| I-4 | Info    | `ReceivedFlag` に `l1` が入らないことは AUTH-5 が覆っている                                                                                   | —                                                                                                                          |

未確認（エージェントに実行手段が無かった）: vitest・pytest の実行、`build:json` の差分、`generate_models.py --check`。メインセッションが実行して Green を確認した（local-ci OK、sfad-done exit 0）。
