#!/usr/bin/env bash
# 国土数値情報 道路データ（N13、2024 年度版、GeoJSON 形式）のうち、初版のゾーンに要る 1 次メッシュだけを取得する。
# 取得先: packages/zones/data/cache/（.gitignore 済み。リポジトリに入れない）
# 利用条件・メッシュの選び方は packages/zones/data/README.md。
#
#   bash packages/zones/scripts/fetch-roads.sh          # 既にあるメッシュは取り直さない
#   FORCE=1 bash packages/zones/scripts/fetch-roads.sh  # 取り直す
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cache="${here}/../data/cache/n13"
base="https://nlftp.mlit.go.jp/ksj/gml/data/N13/N13-24"

# 1 次メッシュ（緯度 40 分 × 経度 1 度）。番号 = floor(緯度×1.5) と floor(経度−100) をつなげたもの
#   6341 苫小牧・登別        6441 札幌・定山渓・恵庭・千歳
#   6542 滝川・芦別（滝里湖）・旭川（神居古潭）
#   6444 釧路・釧路町・厚岸・塘路   6445 浜中・根室（風蓮湖）
#   6544 阿寒・阿寒湖・弟子屈・別海（西春別）
meshes=(6341 6441 6542 6444 6445 6544)

mkdir -p "${cache}"
for mesh in "${meshes[@]}"; do
  name="N13-24_${mesh}_GEOJSON"
  dir="${cache}/${name}"
  if [[ -d "${dir}" && -z "${FORCE:-}" ]]; then
    echo "skip ${name}（取得済み）"
    continue
  fi
  zip="${cache}/${name}.zip"
  echo "get  ${base}/${name}.zip"
  curl --fail --silent --show-error --location -o "${zip}" "${base}/${name}.zip"
  rm -rf "${dir}"
  mkdir -p "${dir}"
  unzip -q -o "${zip}" -d "${dir}"
  rm -f "${zip}"
done
echo "done: ${cache}"
