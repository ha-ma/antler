# SFAD hooks — sfad-guard.py

SFAD の成果物（`docs/specs/{feature}/*.md`）とプロセスゲートを守る PreToolUse hook。
**コードレベルの規約（レイヤ境界・セキュリティパターン）はスタック層の hooks/CI の管轄であり、
ここでは重複させない。**

## 配線

`/sfad init` の Phase 11.5 が自動配線する。手動の場合:

1. `sfad-guard.py` をプロジェクトの `.claude/hooks/` にコピー
2. `.claude/settings.json` の `hooks.PreToolUse` に `Bash` / `PowerShell` / `Write|Edit|MultiEdit` の
   matcher で `python .claude/hooks/sfad-guard.py` を登録（init.md 参照）。
   ランチャーが `python3` の環境では読み替える

## 検査内容と重大度

| 対象 | 検査 | 重大度 |
|------|------|--------|
| `docs/specs/*/functional.md` | frontmatter（feature / target_paths / tier）の欠落・空値 | **deny** |
| `docs/specs/*/threat.md` `resilience.md` | マトリクスの未記入セル（空欄・裸の `-`・理由なしの `N/A` を禁止。該当なしは「N/A: 理由」または「- 理由」。コードフェンス内は対象外） | **deny** |
| `docs/specs/*/*.md` | 逃げ言葉（TODO / 未定 / たぶん 等） | warn |
| `docs/specs/*/functional.md` | Questions 未解決のまま Test List 記述（`[Deferred: 担当/期日/暫定挙動]` 付きは未解決に数えない。3点セット不足は warn） | warn |
| ソースファイルの作成・編集 | 覆う仕様（functional.md の target_paths）が無い（**起動ゲート**。新規・既存の両方で発火。Tier 0 は無視してよい。同一パスにつき1回だけ） | warn |
| `git commit` | シークレットらしきファイル（.env / *.pem / credentials 等。`.example`/`.pub` 系は除外）。`git add -A` 等の add-all を伴うコマンドは未追跡分も検査 | **deny** |
| `git commit` | ソース変更にテスト変更が伴わない | warn |
| Bash での仕様書き込み（本文が見える） | `cat > docs/specs/.../x.md <<EOF` は本文がコマンド内にあるので、Write と同じ内容検査にかける。違反があれば同じ理由で deny、問題なければ黙って通す | **deny** |
| Bash での仕様書き込み（本文が見えない） | `tee` / `sed -i` / `cp`・`mv` / 変数経由のリダイレクトは中身を検査できない。**検査できないものを検査済みとして通さない**（Write / Edit を使えば済む） | **deny** |

## 実装上の要点

- **Edit/MultiEdit は「編集後の全文」を再構成して検査する**（ディスクの現内容に
  old_string→new_string を適用）。再構成できない場合（ファイル未読・old_string 不一致）は
  断片を裁かず**検査をスキップ**する — deny は確実な時だけ
- CRLF と UTF-8 BOM は検査前に正規化（Windows 対応）
- コミット検査の対象は「ステージ済み + そのコマンドの staging 形式が拾う分」:
  `git add -A|--all|.` は未追跡含む全件、`commit -a/-am` は追跡済みのみ。
  **特定ファイルの `git add x && ...` と `git -C dir` 形式は検査対象外**（既知の限界）
- warn は `systemMessage` JSON で通知する（exit 0 の stderr は hooks 仕様で表示が未定義のため）。
  deny は `permissionDecision: "deny"` + exit 0 の現行推奨方式

## 重大度の方針（再構成設計 原則3）

- **deny は誤爆がほぼあり得ない構造違反のみ**（空セル・frontmatter 欠落・シークレット）
- 判断を含むものは全て **warn から開始**し、`.claude/logs/sfad-guard.jsonl` の発火ログ
  （ts / kind / path / detail）で誤爆率を測定してから deny への昇格を判断する
- 起動ゲート（warn）は「必ず SFAD フローを通る」の第一段階。測定後に deny 昇格を検討

## sfad-drift.py（乖離検出）

`/sfad drift` の実体。仕様の最終更新以降のコード変更（STALE）、threat.md に無い
実在ルート（THREAT GAP）、逆に threat.md にあるのに消えたルート（CONTRACT GAP）、
Rule→語彙対応表の置き場所欠落（BRIDGE GAP）、Test List に対応するテストの不在
（COVERAGE GAP）、❌ セル数に対する AUTH-* の不足（AUTHZ COVERAGE GAP）を検査する。
exit 0/1/2 で CI に組込可。詳細は `../drift.md`。

## sfad-done.py（完成判定）

Test List 消化 / 仕様ゲート / drift クリーン / テスト Green の4項目を見て exit 0/1/2。
**「完成」を Claude の自己申告からこの exit code に移すためのもの。** 仕様ゲートは
`sfad-guard.py` を subprocess で呼ぶ（検査の写しを持たないので hook とズレようがない）。

設計の核は **検証できなかった項目を合格にしないこと**。テストコマンドを特定できない、
guard が異常終了した、といった場合は UNKNOWN として不合格にする。「確かめられなかったので
通す」で緑になったら自己申告に戻ってしまうため。

テストコマンドは `SFAD_TEST_CMD` → `.claude/sfad.json` の `test_command` → プロジェクト
ファイルからの推定、の順で決める。**このコマンドはシェルで実行される**（テスト実行は
そもそもリポジトリのコードを走らせる行為なので、`.claude/sfad.json` は信頼できる出所から
のみ受け取ること）。

## テスト

```
python skills/sfad/hooks/tests/test_sfad_guard.py
python skills/sfad/hooks/tests/test_sfad_drift.py
python skills/sfad/hooks/tests/test_sfad_done.py
python skills/sfad/hooks/tests/test_readme_contract.py
python skills/sfad/hooks/tests/test_stack_contract.py
```

自己完結の挙動テスト（一時 git サンドボックスを自動構築）: guard 65 + drift 25 +
done 15 + README 契約 8 + 層の継ぎ目 49 ケース。deny・warn・許可/沈黙と、レビューで
検出した誤爆・検出漏れの回帰ケースを含む。**変更時は必ずこのテストで回帰確認すること。**

`test_stack_contract.py` は `../CONTRACT.md` の委譲表と `stacks/` の実物を突き合わせる
（配布先には `stacks/` が無いので SKIP する）。参照先の消滅だけでなく、見出しの改名、
hook が両 matcher に配線されているか、実際に起動できるかまで見る。

`test_readme_contract.py` は**上の重大度表そのものを検査する**。表の各行に対応する
入力を実際に hook へ流し、宣言した deny/warn と実際の挙動が一致するかを見る。
表に行を足して検証を書かなければ落ちるし、文言を書き換えても落ちる（再確認の強制）。
空セル検査が「N/A: 理由」を要求すると宣言しながら実装は空文字しか見ていなかった、
という食い違いが長く残ったのは、宣言と実装を突き合わせるものが無かったため。
