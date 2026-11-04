# alert-contract-guard: edge-capture（2026-11-04）

Critical 0 / Warning 4 / Info 6。形の一致（edge の Capture と `CaptureSchema`・`L1ProbsSchema`）、同意の二重確認、「保存しない」項目、sim から呼べる形は問題なし。観点 5・6（B の既存契約、`packages/schema`・`alert-ui` の無変更）は読み取りの道具だけで確かめられず未確認だったので、呼び出し元が `git diff --stat fc970a2..HEAD -- packages/schema packages/alert-ui` で確かめた（変更なし）。

| #   | 指摘                                                                                                                 | 対応                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | edge の実 JPEG を api の画像検査に通したテストがない。通らないと PWA が 400 を「直らない」と扱って同意済みを削除する | 直した: OpenCV の出力を固定ファイルにして `inspectCaptureImage` に通す契約テスト IMG-1g（通る）。400 `INVALID_IMAGE` では削除しない（UP-1e） |
| W-2 | `uploadCapture` 自体に `isUploadable` の確認がない（sim が共用）                                                     | 直した: 先頭で確認し、外れたら送らず permanent（UP-1c）                                                                                      |
| W-3 | sim が `uploadCapture` に届かない（PWA の feature は sim から import できない）                                      | 仕様の Deferred（担当=人 A、sim の「見つけた」で共有パッケージまたは複製）。この feature の範囲外                                            |
| W-4 | xywh の基準（左上）が B の spec にしか書かれていない                                                                 | `docs/changes/2026-11-04-capture-xywh-top-left.md` に記録                                                                                    |

Info: `light.py` の固定地点の定数名は hook に当たらない名前（`SITE_NORTH_DEG`・`SITE_EAST_DEG`）。sim が 1280×720 を送るなら JPEG（512 KiB 上限）。ブラウザの canvas が出す JPEG・PNG の検査（Safari の ICC など）は実エンコーダで試す必要がある（sim の feature で）。
