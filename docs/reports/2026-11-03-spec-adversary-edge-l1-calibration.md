# spec-adversary: edge-l1-calibration（docs/specs/edge-l1-calibration/functional.md のドラフト）

2026-11-03。spec-adversary（読み取り専用）の返事を、メインセッションがこのファイルに写した（エージェントに Write が無いため）。
照合したファイル: `edge/detector/src/detector/l1/calibration.py`・`request.py`・`fusion.py`・`l0/tracker.py`・`config.py`、
`apps/sim/src/features/drive/domain/deer-motion.ts`・`detection.ts`・`deer-spawn.ts`・`vehicle.ts`、`docs/specs/edge-l1/functional.md` R2・R4・R5。

## Critical

### C1 [R5] ラベルがその瞬間だけで決まり、これから車線に入る鹿を「路肩で静止・zone」と教える

- crossing・herd・frozen は `gap > triggerM`（80〜100 m）のあいだ路肩で静止している。見え始める 120 m から 80 m までの tick は roadside と同じラベル（static_shoulder・zone）になる。herd の 2 頭目以降も待つあいだ同じ
- fusion の `conclude` は zone ≥ 0.9 を降格の理由にし、pos が shoulder なら条件 4 も通る。校正が「渡る直前の鹿は zone と言い切ってよい」と学ぶ
- frozen の出始め（ramp 0.15）は横の速さが 0.5 m/s に届かない。danger の「道のり ÷ 車の速さ」の速さが未定義（request の固定値 60 km/h と食い違う）
- 推奨: 先読み（tq から 6 秒以内に車線に入るなら on_roadway・danger・static_shoulder 偽）。danger の時間は request と同じ速さで割る。Example を足す

### C2 [R3] 問い合わせの分布が実行時と違う

- 実行時に L1 が聞かれるのは赤の候補（最後の点の conf ≥ judge.threshold 0.8）だけ。tq を見える tick から一様に選ぶと、実行時に聞かれない場面が入る
- トラッカーは window_s 1.0・max_age_s 1.0。64 点・6.4 秒の track や「途切れたら数え直す」は edge と違う
- 赤になった瞬間の 1 点の track（lateralMps 0、ttc null）が学習に出ない
- 推奨: tq は conf ≥ threshold の tick から。track は window_s で切り、max_age_s 以下の途切れは続ける。1 点の track も入れる

### C3 [R2・R3・R7・R9] false_positive の温度が仮の定数で決まり、書いてよいかの判定が無い

- 鹿でない物と roadside の鹿は track の形で区別できず、違いは仮の conf の基準だけ。鹿でない物 3 割は降格を増やす向き
- false_positive は条件 4（pos）で止まらないので最も危険。降格の精度は出すだけで、書く判定に使わない。学習と評価が同じデータ
- 推奨: トレース単位で学習用と検証用に分け、検証用の降格の精度で書くかを決める。実データまで T ≥ 1 に抑える案。鹿でない物の割合の実値は Deferred。本物の鹿を降格した件数を pattern 別に出す

## Warning

- W1 [R7] T が下限より少し上（0.06 など）なら書いてしまう。推奨: 「校正後 0.9 になる生の確率」を出し、鋭くしすぎる T は書かない
- W2 [R5・R7] none が正解に一度も出ない。conclude は none ≥ 0.9 でも降格する。推奨: none ≥ 0.9 の件数を出す
- W3 [R6・R7] `--per-trace` で件数の下限を水増しできる。答えの行に出どころ（source）が残らず、合成から学んだ温度でも実体のモデル名なら実行時に効く。推奨: 件数は別々のトレースで数える、meta を持ち越す、synthetic は `--allow-synthetic` なしでは書かない、テストは tmp_path だけ
- W4 [Test List] AC-2・FIT-1a は自分で作った答えから温度を取り戻すだけ。AC-3 は雑音が無いと分離できるデータになり、書かない条件と矛盾する。推奨: AC-3 に雑音、構造的に間違う偽 L1 で書かないテスト

## Info

- I1 [R8] 一時ファイルは同じディレクトリに作り `os.replace`。書く側でも `model != model.strip()` を検査し、3 キーだけを書く
- I2 [R2・R6] eyeshine は常に遮蔽され全部捨てられる（学習のパターンの割合は sim と変わる）。件数は捨てたあとの問い合わせの数。合成の車はブレーキをかけない

## 問題なし

画角 ±35°・tick 10 Hz・conf の下限 0.40・車線の半幅 1.75・`load_calibration` と当て方の式の一致・log β の黄金分割探索。

## メインセッションの取り込み（2026-11-03、推奨で決定）

- C1 → R5 に先読み（6 秒）。danger は request の速さで割る。LBL-1f〜1h を追加
- C2 → R3 を「赤の候補の tick から、2.5 Hz の問い合わせの時刻を選ぶ」「window_s・max_age_s で切る」「1 点の track も出る」に。TRK-1f・1g を追加
- C3 → R7 に検証用の分割（トレースの id のハッシュで 3 割）と書く判定（検証用で正解 danger を降格した件数 0、降格の精度 0.9 以上）。T の下限 0.25（W1 と合わせて）。鹿でない物の割合は 25%、実値は Deferred
- W2 → 評価に none ≥ 0.9 の件数。W3 → 件数は別々のトレースで、meta を持ち越し、synthetic は `--allow-synthetic` なしで書かない。W4 → AC-3 に雑音、FIT-1g（構造的に間違う偽 L1）
- I1・I2 → R8・R6 に明記
