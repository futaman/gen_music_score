#!/bin/sh
# PDF の日本語用フォント（public/fonts/BIZUDPMincho-Regular-jis.ttf）の作り方。
# BIZ UDP明朝（SIL Open Font License 1.1）から、JIS X 0208 の文字と Latin-1 だけを残して小さくする（約6MB → 約2.7MB）。
# 元のフォント：npm の @expo-google-fonts/biz-udpmincho（400Regular/BIZUDPMincho_400Regular.ttf）
# 必要なもの：python3 と fonttools（pip install fonttools）
set -e
SRC=${1:?元のTTFのパス}
python3 - <<'PY' > /tmp/jis-chars.txt
chars = set(chr(c) for c in range(0x20, 0x7f)) | set(chr(c) for c in range(0xa0, 0x100)) | set('♯♭♮“”‘’–—…')
for b1 in range(0xa1, 0xff):
    for b2 in range(0xa1, 0xff):
        try:
            chars.add(bytes([b1, b2]).decode('euc_jp'))
        except UnicodeDecodeError:
            pass
print(''.join(sorted(chars)), end='')
PY
pyftsubset "$SRC" --text-file=/tmp/jis-chars.txt --output-file=public/fonts/BIZUDPMincho-Regular-jis.ttf \
  --no-hinting --desubroutinize --layout-features='' --name-IDs='*'
