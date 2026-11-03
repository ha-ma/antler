# alert-contract-guard: alert-ui（2026-11-03）

対象: `git diff chore/agent-team-alignment...feat/alert-ui -- packages edge`。結果: **Critical 0 / Warning 3 / Info 4**。

## Warning（次に回す）

| #   | 内容                                                                                                                                 | 場所                                                   | 扱い                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| W-1 | 読み上げがブラウザの speechSynthesis（ch5 は事前合成の音声ファイルを同梱・オフライン）。端末で声が変わり、TTS の無い端末では鳴らない | `sound/web-audio-port.ts`、`sound/sound-controller.ts` | functional.md の Deferred（期日 2026-11-04）。ファイルが揃うまで Warning のまま  |
| W-2 | `distance` を `number \| undefined` に広げた（AlertState.md は `number`）。「--」表示は設計書に無い                                  | `components/AlertState.tsx`                            | 回答 7・18 で決めた挙動。AlertState.md（Claude Design）に追記する                |
| W-3 | en / zh / ko の読み上げ文（`speech`）は実装側が決めた                                                                                | `i18n/i18n.ts`                                         | 音声ファイルの原稿をこの `speech` に固定する。ネイティブ確認（Deferred）に含める |

## Info

- compact の白枠は 6px（AlertState.md は 14px）。AlertState.md に compact の例外を補足するか 14px にする
- チャイムの再入場抑止 30 秒（`ZONE_REARM_MS`）は ch5 に無い追加。回答 12 で決定。ch5 側に反映する
- ビープの gain 0.9。最大音量は OS のメディア音量と B-0 の案内で担保
- 守るテストが足りない観点: `@antler/alert-ui` 以外から AlertState を import していない／`alert-danger` を AlertState 以外で使っていない／A でアラート OFF のとき danger を出さない（消費側の feature の受け入れテストで覆う）

## 合格にした観点

形（円・三角・八角）と色はトークンの CSS 変数だけ、鹿の SVG は 1 つ、点滅 1 Hz、ビープ間隔とチャイム、副文 3 言語、AlertFlag（v・時刻必須、deer:true で距離と方向必須、strict の 4 通りの union）、Capture（strict・個人情報と座標のキーを拒否・consent 必須・isUploadable）、ClientMessage（flag を送れない）、JSON Schema の一致テストと edge の契約テスト。

## 未確認（差分に消費側が無いため）

TripPlan の seed の再生（sim・api）、PWA の ack・Wake Lock・回転ロック・未接続の帯、edge のフラグ送信と Capture 保存のフィールド、A のアラート OFF 経路、edge の 1.5 秒解除。各 feature の cycle で alert-contract-guard を回す。
