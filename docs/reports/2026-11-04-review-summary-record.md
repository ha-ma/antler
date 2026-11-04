# record のレビューのまとめ（2026-11-04）

5 種のレビューと alert-contract-guard を同時に回した。**Critical はすべて 0 になった**（accessibility-checker の Critical 2 件は直した）。
全文は各レポート: code-reviewer・component-guard・accessibility-checker・security-auditor（同じ日付の `*-record.md`）。layer-guard と alert-contract-guard は返信だけで返ったので、要点をここに残す。

## 直したもの

| 出どころ                        | 指摘                                                                                                                  | 直し方                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| accessibility C1                | 削除の確認を開く・やめるでフォーカスが body に戻る                                                                    | 開くボタンを残して `aria-expanded`、確認の文にフォーカス、「やめる」でボタンに戻す（テストで確かめる）                           |
| accessibility C2                | 入力枠・副ボタンの枠（line）が 1.3:1                                                                                  | `ink-faint` に（3:1 以上）                                                                                                       |
| accessibility W                 | 押すと disabled でフォーカスが外れる／画像の保存の成功が伝わらない／読み込み中の aria-busy／SSR の span の aria-label | `aria-disabled`、「画像を保存しました」を status に、aria-busy を外す、見えない文字のラベル                                      |
| accessibility W（SSR）          | `</html>` が body の前に出る                                                                                          | Prettier が閉じていないテンプレートに `</html>` を足していた。文書全体を 1 つのテンプレートで組む（テストで 1 つだけを確かめる） |
| code-reviewer W3                | 同じ記録の OG を同時に取ると枠が埋まって 503                                                                          | 鍵ごとに描画中の Promise を共有（テスト追加）                                                                                    |
| code-reviewer W4                | OG の鍵が旅の不変に依存                                                                                               | コメントで前提を書いた（plan-trip R10）                                                                                          |
| code-reviewer W5 / security Low | 書き込みの上限が route ごとに別枠（実質 20 件/分）                                                                    | 書き込み（runs・DELETE）と読み出し（record・/t）をそれぞれ 1 つの枠に                                                            |
| security Low                    | 削除した旅の OG 画像がメモリに残る                                                                                    | 削除のあとに `forget(tripId)`                                                                                                    |
| security Low                    | 本番で公開 URL が localhost のまま起動できる                                                                          | 起動時に warn（止めない）                                                                                                        |
| component-guard W1              | 1 ファイルに複数のコンポーネント                                                                                      | StatTiles・KeptList・ZoneLog・ShioriCard・BIntro・BrandMark・RecordContent に分けた                                              |
| component-guard W2              | 描画中に localStorage を読む                                                                                          | `useIsOwner`（最初の 1 回だけ読む）                                                                                              |
| alert-contract-guard W-1        | SSR の CSS 変数に alert-* が出る                                                                                      | alert-* / on-alert-* を出さない                                                                                                  |
| alert-contract-guard W-2        | B の導線のスマホの印が緑の円だけ                                                                                      | 円＋チェック（safe の形）に                                                                                                      |
| spec の UC-5a                   | 表が増えても削除の足し忘れを止められない                                                                              | `trip_id` を持つ表の一覧を固定（増えたらテストが落ちる）                                                                         |

## 持ち越し（Warning・Info。次の feature か Day 5〜6）

- code-reviewer W1: 件数の確認と挿入の同時実行（libsql の既定のトランザクションが deferred なら `SQLITE_BUSY` で 500 の恐れ）。同時実行のテストが無い。1 プロセス・書き込み 10 件/分/IP なので今は低い
- code-reviewer W2: 保存した行が壊れていて同じ runId を再送すると 500（手で DB を直したときだけ）
- code-reviewer W6: トークンなし・body も不正な要求は 401 でなく 400（検証が認可より先）。挙動として受け入れ
- security M1: OG の描画枠（同時 2 枚）を IP を替えて埋めると、SNS のクローラーが画像を取れない。同じ記録の同時取得は共有にしたので緩和。本格的には描いた PNG をファイルや CDN に置く
- security M2: 記録の URL の ID で brief-map の API から旅を丸ごと読める（threat.md に「残る課題」として記録済み）
- security Low: `secure_delete` が無い（SQLite のページに消した中身が残りうる）、レート制限の鍵の押し出し、resvg-js の保守
- component-guard W3: 削除の mutation を RecordPage → RecordContent → DeleteSection と渡している（成功したら記録の代わりに「削除しました」を出すため、ページで持つ）
- component-guard W4: `apiBase()` が plan-trip・brief-map・record で重複。shared/ に上げるのは別の PR で
- layer-guard W: `/t/:id` の route で TripNotFoundError を捕まえて HTML の 404 を返す（error-mapper は JSON だけ）。route が `buildRecordView` を呼ぶ。どちらも表示の変換で業務判断ではないので、この形のまま
- accessibility の残りの Warning（「—」の読み上げ、`list-style:none` の VoiceOver、単位の文字の小ささ など）は Day 5 の全画面の確認で

## layer-guard（返信の要点）

Critical 0。domain/record は import 0、application に hono / drizzle / zod の import なし、UseCase に HTTP の知識なし、例外は error-mapper で変換。Warning は上の 1 行と、container で GetTripRecordUseCase にだけ repository を直接渡している点（組み立ては container の中なので違反ではない）。

## alert-contract-guard（返信の要点）

Critical 0。alert-danger の使用は record のファイルに 0 件（衝突の印・削除のボタン・エラーは clay / clay-deep）。`packages/alert-ui/package.json` の `"./tokens"` は 1 行の追加だけで、既存の export・AlertState の props・色の値は変わらない。凍結 API への影響なし。
