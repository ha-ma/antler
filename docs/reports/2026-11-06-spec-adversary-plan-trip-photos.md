# 敵対レビュー結果: plan-trip-photos（2026-11-06、spec-adversary）

対象: `docs/specs/plan-trip-photos/functional.md` のドラフト（重さを外す・写真と引用）。エージェントに書き込みの手段がないため、メインセッションが返答をそのまま保存した。

## 要約（重大なものから）

1. 「stop-events は直さなくても意味が保たれる」は成り立たない。`weightForHours` を通すと滞在は 0.5 時間でも 1 時間でも 96 分、4 時間は 288 分になり、しおりの時刻（hours × 60 分）とずれる
2. 旅の組み立てが、保存されない master の `hours`（verified:false）に依存する。値を直すたびに保存済みの旅が ItineraryChangedError になる。旅は deploy-a で Turso の本番にもあり、「ローカルだけ」の前提は崩れている
3. CC BY の帰属表示（TASL）が足りない。カードに作品名とライセンスの URL がなく、「縮小した」は CREDITS.md にしか書かれない。ch6 の許可リストにはパブリックドメインがない
4. 取得スクリプトは、リダイレクトで通信先の制限を抜けられる。サイズの上限が受信中に効く保証も、中身が本当に画像かの確認もない。記録する SHA-1 は原本のもので、保存した縮小版の確認にはならない
5. 入りきらないときに所要の短いものから外すと、長い 1 件を残すために短いものを何件も外すことがある。Example がない
6. 「重さ」が stop-events のモーダル・選択肢と、loss の達成の重さにそのまま残り、利用者に見える
7. 12px のリンクは押せる面が小さく、新しいタブで開くことも伝わらない。顔・商標・鹿の判定は機械のテストでは確かめられない

## 追加すべき Example（既存 Rule の穴）

- [R3] 0.5・1・3・4 時間の楽しみを入れた旅で、stop-events の stayMin（weight × 96 分）がしおりの活動時間と同じになる Example — 換算値は 0.5h→1→96 分（3.2 倍）、1h→96 分、3h→192 分、4h→288 分（+48 分）。stop-deck-policy の pauseStartMs は、出発前の楽しみの開始を「最初の移動の出発 − 滞在の合計」で逆算するので、滞在が長すぎると開始が前にずれ、次の移動の出発に重なる。spentJPY（予算 × 滞在 ÷ 1 日の分）も過大になる。以前は act = w × 1.6h = w × 96 分で一致していた。直し方は、stop-material.ts で stayMin を `hours × 60` にするか、weight を通さないか
- [R2] 所要 8 時間の 1 件を外せば入るのに、1〜2 時間の 3 件が先に外れる Example（DUR-3 の対）— 外す順が「重要度の低い順」から「解放する時間の小さい順」に変わった。重さが無くなったいま「時間をかけるものが主目的」は推測にすぎない
- [R8] 許可したホストへの要求が 30x で別のホストへ飛ぶ、Content-Length が無いか偽、Content-Type は image/jpeg で中身が HTML・SVG の Example — `redirect: 'manual'` か最後の `response.url` を調べる。上限は受信中のバイト数で効かせる。先頭のバイト（JPEG FF D8 FF、PNG 89 50 4E 47）を調べ、幅・高さは実物から取る

## 追加すべき Question（未定義の振る舞い）

- `hours` は暫定値で、TripPlan（凍結）には保存されない。値を 1 件直すと保存済みの旅が brief-map・stop-events・drive-link でまとめて ItineraryChangedError になる。本番（Turso）の旅をどう扱うか、master の値を直す手順をどうするか [PO/Dev]
- ch6 の許可は「CC0 / CC-BY / 自作のみ」。パブリックドメインは無い。PD を許すか、どの種類を許すか [ユーザー]
- stop-events のモーダル（`重さ {n}`）・選択肢（`−weight {n}`）と loss の achievedWeight / totalWeight に換算した重さが表示され続ける。消す・言い換える・そのまま [PO]
- 複数ライセンスのファイルで LicenseShortName は 1 つしか返さない。`License` のコード（cc-by-4.0 / cc0）の許可リストで判定するか [Dev]
- weight を任意にしたとき、冪等キーのハッシュに weight が入るか。weight だけが違う body を同じキーで送ったら 409 か。weight: null・2.5・"3" は 400 か [Dev]

## 甘い仮定（明文化が必要）

- TASL の残り: 作品名（Commons のタイトル）、ライセンス本文へのリンク、改変の表示（「640px に縮小」をアプリから届く表示に）。`Attribution` があれば `Artist` より優先。平文にするときに帰属先を落とさない
- Commons の SHA-1 は原本の識別子。改ざんの確認は取得時に計算した SHA-256 だけ。EXIF（撮影位置など）を消すか
- 顔・商標・鹿・hours の妥当さはテストで確かめられない → photos.json に人の確認の欄（`reviewedBy`・`reviewedAt`）を足し、欄があることだけを機械で調べる
- 12px・ink-faint の引用リンク: 下地によっては 4.5:1 を割る。リンクの大きさ（24×24px 以上、プロジェクトは 44px）、新しいタブで開くことの伝達、下線、同じ撮影者が並んだときのリンク名の区別（楽しみの名前を含める）

## 問題なし

CSP（img-src 'self'）と写真を同じ origin に同梱する構成、写真を alt="" にしてボタンの外に引用を置くこと、weight を任意にしても範囲外は 400 という互換、新規の旅で buildDayPlan の作り直しが一致すること。
