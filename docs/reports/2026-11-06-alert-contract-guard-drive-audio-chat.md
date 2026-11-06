# alert-contract-guard: drive-audio-chat（ブランチ feat/drive-audio-chat）

エージェントは読み取り専用のため、メインセッションが要約を写した。結論: **Critical 0 / Warning 3 / Info 4**。`@antler/alert-ui`・`packages/schema` の変更なし。

## Critical

なし。

- 運転の音は独自の AudioContext を持ち、alert-ui の AudioContext・speechSynthesis と master を共有しない。ビープと読み上げを消したり遅らせたりする経路は無い。赤の間は BGM 0・エンジンとブレーキ 0.5 倍・通知音 0（mix.ts）。BGM は 0.04 秒の時定数で下がる
- `audio/`・`chat/` に alert-danger・alert-zone・alert-safe の参照も色の直書きも無い
- 運転の音の消音（AudioSettings.muted）は mixLevels の master だけを 0 にし、AlertState の muted に渡る経路は無い
- アラート OFF の走行では danger が出ない。ゾーンで BGM を下げず（R6a）、通知音は鳴り、zone-enter を出さない
- 鹿を見つけたと言わせない仕組みは 2 段（api の DEER_WORD の検証で作り直し・502、端末の固定文に鹿の語が無い）
- api は TripPlan の seed・lang・party.size・party.experience だけを読む。乱数はシード付き

## Warning

- W-1 `chat-feed.css`: 赤の間の opacity 0.6 で、話し手の名前（ink-muted・12px）の実効コントラストが 4.5:1 を割る可能性。直すなら文字色を保って背景で減光する、など（3D の景色越しなので組み込み後に実測。plan.md の PR 2）
- W-2 `ChatFeed.tsx`: 見えない aria-live は琥珀の間も新しい行を読み上げる（通知音は琥珀で鳴らさないのに、読み上げには効かない）。組み込みで zone も渡し、琥珀の間は読み上げを控える案（PR 2 で判断）
- W-3 テストの観点の確認: OFF の zone で BGM 1.0・通知音が鳴る・danger で notify 0・danger では outcome にかかわらず BGM 0 の 4 つ（→ audio-model.test.ts の AUD-3e で確かめている）

## Info

- 組み込み（DriveScreen への useDriveAudio・ChatFeed・AudioControls）は PR 2。AudioControls の消音が AlertState に伝わらないこと、ChatFeed の dimmed に danger だけを渡すことは PR 2 で確かめる
- ブレーキの鳴き（1,800 Hz）と alert-ui のビープ（1 kHz 付近）は帯域が近い。赤の間は 0.5 倍なので許容。実機で聞く Deferred（2026-11-08）に含める
- ChatFeed の lang の出どころを TripPlan.lang にすること（PR 2）
