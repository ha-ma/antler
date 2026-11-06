# drive-tourism: レビューで残した Warning（次に回す）

2026-11-06。5 つのレビュー（component-guard・accessibility-checker・code-reviewer・layer-guard・security-auditor）はどれも Critical 0。
直したもの・残したものを 1 か所にまとめる。全文は同じ日付の各レポート。

## 直したもの

| 指摘                                 | 直し方                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| component-guard W1                   | 見本の会話の楽しみを useMemo の中で選ぶ（依存は立ち寄りの id・到着地・出発の時刻）             |
| component-guard W2・code-reviewer I4 | `RecommendCard` を `memo` に                                                                   |
| component-guard W3                   | `RecommendTracker` は運転を 1 回だけ購読して自分の購読者に配る。誰もいなくなったら購読をやめる |
| component-guard W4                   | tracker の作成と購読を `hooks/use-recommendation.ts` に                                        |
| accessibility-checker W1             | 赤の減光の間は話し手・出典の文字を ink にする（12px で 4.5:1 を保つ）                          |
| accessibility-checker W2             | 右の列のカードに `max-height: 60%`（文字の拡大で音量の操作を押し出さない）                     |
| code-reviewer W2・security W1        | api の材料の `stops` もマスターにある楽しみだけに絞る                                          |
| code-reviewer W3                     | 楽しみは「話した回数のいちばん少ないもの（同じなら候補の順）」を選ぶ。テストを足した           |
| code-reviewer W4（一部）             | UC-1b の空振り防止、`RecommendTracker` の購読のテスト                                          |
| code-reviewer W5                     | 見本の会話の楽しみの文を、景色・食事・温泉のどれにも合う言い方に                               |
| code-reviewer I5・a11y Info          | カードの名前は `aria-labelledby` で見出しを指す（2 回読ませない）                              |
| code-reviewer I7                     | 端末の応答の確かめで、楽しみ以外の話題の行の `pleasure` は null                                |

## 残したもの（次に回す）

- code-reviewer W1: `recommend.ts`（純粋関数）が `StageBanner.tsx` から `STAGE_BANNER_MS` を読み、帯が出ているかの判定が 2 か所にある。`stage-banner.ts` に `isStageBannerShown` を置いて両方から使う（StageBanner は drive-tune の部品なので、並走中のセッションと重ならないときに）
- code-reviewer W4（残り）: `lengthOf` の境界（2・4 時間）、`laterStopsOf` の重複除外と上限、応答 schema の slug 正規表現に全楽しみの id が合うことのテスト
- accessibility-checker W3: ゾーンに入った瞬間に会話の読み上げ（polite）が AlertState の `role=status` と重なりうる。ゾーンに入った反応は 2.5 秒遅らせて出すので、重なるのは同じフレームに道のりの行が来たときだけ。実機の読み上げソフトで確かめる
- security-auditor W2: 材料に利用者の自由入力が入らないことを固定するテスト（今は入っていない）
- layer-guard Info: `chat.schema.ts` の topic の enum を domain の `TalkTopic` と `satisfies` で揃える
- code-reviewer I1: 見本の会話は、ゾーンの手前へ動かした行で並べ替えると i mod 3 の順が画面の順とずれうる（長いゾーンだけ。見本なので実害は小さい）
