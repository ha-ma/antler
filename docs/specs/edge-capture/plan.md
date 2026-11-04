# 計画: edge-capture（検知フレームの保存・走行後の同意・アップロード）

PR は 1 つ（ブランチ `claude/edge-capture-23a29e`、base は main）。メインセッションの指示（1 feature = 1 PR）に従う。
実装は edge・api・PWA の 3 つが互いに独立しているので、コミットを 3 つに分け、速度優先で api と PWA はサブエージェントに並行して作らせてよい（担当のディレクトリが重ならない）。
合計は 1,000 行を超える見込み（実装 約 1,800 行、テスト 約 2,200 行）。**1 PR ≤ 1000 行の目安を超える理由**: 3 つの部品が受け入れ AC-1〜AC-3 と契約（Capture の形・欄名・同意）でつながり、分けると契約が 2 つの PR にまたがって片側だけ入る期間ができる。コミットを部品ごとに切り、レビューはコミット単位で読める形にする。

## Implementation Plan

### PR チェーン（コミット単位）

| #   | タイトル                                 | 含むもの                                                                                                                                                                                                                                 | 行数目安 | 依存                              | テスト要件                                                                      |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------- |
| 1   | docs(spec): edge-capture                 | functional / threat / resilience / plan、spec-adversary の報告                                                                                                                                                                           | 700      | なし                              | なし                                                                            |
| 2   | feat(api): POST /api/captures            | `domain/captures`（models・rules・errors）、`ports/repositories/capture.repository.ts`、`usecases/captures`、`file-capture.repository.ts`、`capture.routes.ts`、`capture.schema.ts`、error-mapper・app.ts・env.ts・container.ts への数行 | 900      | #1                                | unit（IMG・API・AUTH-1〜6・IDEM・CONC・FAIL-8）、AC-2                           |
| 3   | feat(edge): 検知フレームの保存           | `capture/`（model・light・jpeg・store・recorder・http・service）、`FrameResult.image`、`run_l1` の観察者、設定、`config.example.toml`                                                                                                    | 1,200    | #1                                | unit（CAP・LIGHT・REC・L1P・STO・HTTP・WIRE・CFG・FAIL-1〜7・AUTH-7〜11）、AC-1 |
| 4   | feat(pwa): 走行後の同意と送信            | `features/capture/`（CaptureGate・i18n・edge/api クライアント・`uploadCapture`・hooks）、`App.tsx` に 1 行                                                                                                                               | 900      | #1（契約）。#2・#3 とは並行できる | unit（GATE・UP・URL・AUTH-12・FAIL-9・FAIL-10）、AC-3                           |
| 5   | docs: レビューの報告と spec_confirmed_at | `docs/reports/`、edge-l1・edge-camera の spec_confirmed_at                                                                                                                                                                               | 100      | #2〜#4                            | なし                                                                            |

### 依存グラフ

```
#1 spec ──┬── #2 api ──┐
          ├── #3 edge ─┼── #5 報告
          └── #4 pwa ──┘
```

契約（欄名 `capture`・`image`、edge の URL とパス、Capture の形）は functional.md が正。3 つは互いのコードを import せず、`@antler/schema` と JSON Schema だけを共有する。

## このフェーズで実装すること（In Scope）

- edge: Capture の組み立て、保存のポリシー（確信度・間隔・上限）、画像の縮小と JPEG 化の port、ローカル保存、`l1Probs`、PWA 向けの HTTP、つなぎ（`CaptureService`）、`FrameResult.image`、`run_l1` の観察者、設定
- api: `POST /api/captures`（multipart、同意、画像の検証、冪等、ファイル保存）
- PWA: 走行後の同意の画面、edge から取って api へ送る手順、`uploadCapture`（sim から使える純粋な関数）、4 言語
- 仕様の整理: edge-camera の Deferred「xywh の基準」を左上基準で決着、edge-l1 の spec_confirmed_at の更新

## このフェーズで実装しないこと（Out of Scope）

- sim の「見つけた」の画面（`uploadCapture` と POST の形だけ用意する）
- `dataset/` への取り込み・学習・実写の画像の追加（ch9 ③ は要確認のまま）
- ナンバー・顔のぼかし、ボンネットのマスク、画像の保持期間による削除
- 位置の区間（`roadSegment`）を埋める経路（pwa-uplink。`SegmentProvider` の口だけ）
- 音声ラベル B2-6、`outcome`・`weather` などの本物のラベル
- edge の起動入口（`__main__`）への配線（入口を作る feature で `CaptureService.from_config` を呼ぶ）
- `packages/schema` の変更（凍結。`Capture`・`isUploadable`・`l1Probs` はそのまま使う）
- api の SQLite の表（`db/schema.ts`・`migrate.ts` は触らない。他のセッションと衝突させない）

## マイグレーション統合

- api: 表は足さない。起動時に `CAPTURES_DIR`（既定 `./data/captures-received`）を作る（`mkdir -p`、0700）。戻す操作はディレクトリの削除だけ
- edge: `capture.dir`（既定 `captures`、設定ファイルのディレクトリから）を起動時に作る（0700）。起動時に孤児を掃除する
- 生成物（`edge/detector/captures/`・`apps/api/data/`）は git に入れない（`.gitignore` を確かめ、無ければ足す）

## 凍結

`packages/schema`・`packages/alert-ui` は変更しない（`Capture`・`isUploadable`・`L1ProbsSchema` を使うだけ）。alert-contract-guard で Critical 0 を確かめる。
edge の `l1/runner.py` に観察者の引数を足す（既定 None で今までと同じ動作）。edge-l1 の挙動の仕様は変わらないので、`spec_confirmed_at` を更新する（前回の edge-l1-calibration と同じ段取り）。

## 並行セッションとの境界

- `apps/api` の `app.ts`・`container.ts`・`error-mapper.ts`・`env.ts`: 独立した数行のブロックだけ足す（stop-events・loss・record と同じファイルなので、マージ時に衝突したら両方を残す）
- `apps/pwa`: `features/capture/` と `app/App.tsx` の 1 行だけ。`features/connect` は触らない（pwa-uplink）
- `edge/detector`: `capture/` の新規ファイルが中心。`config.py`（セクションの追加）・`pipeline.py`（`image` の 1 欄）・`l1/runner.py`（観察者）は小さな追加。`server.py`・`hub.py` は触らない（pwa-uplink）

## リスクと対策

| リスク                                                          | 対策                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存が赤の経路を遅らせる                                        | `offer` は縮小のコピーだけ、変換と書き込みは別スレッド、有界キューで溢れたら捨てる。`wrap` は結果を先に渡す。edge-latency-reviewer が確かめる |
| 同意の無い画像が api に入る                                     | PWA が `isUploadable` で止め、api も `consent: true` でなければ 422（二重の確認）                                                             |
| 画像に位置などのメタデータが残る                                | edge の JPEG 化はメタデータを書かない。api が APPn・COM・不許可の PNG チャンクを拒否                                                          |
| 車内ネットワークの別サイトのページから Capture を読み書きされる | 許可リストの Origin だけ ACAO、POST は JSON のみ・Origin 検査（403/415）                                                                      |
| パスをたどって別のファイルを読む                                | `id` を正規表現で検査してからパスにする。api はクライアントの `image` を使わない                                                              |
| api の容量を埋められる                                          | 1 分 60 件 / IP、1 枚 512 KiB、本文 640 KiB、保存件数の上限                                                                                   |
| edge の `__main__` が無く、部品が使われない                     | PR に明記。`CaptureService.from_config` が入口になる。Deferred に残す                                                                         |
| 他のセッションとファイルが衝突する                              | 上の境界。数行の独立した追加にとどめる                                                                                                        |
