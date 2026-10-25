#!/bin/sh
# Fetch the OFL fonts these mockups use (not committed: the Japanese ones are megabytes each).
# Run from this directory; the pages load them from ../fonts/.
set -eu
G=https://raw.githubusercontent.com/google/fonts/main/ofl
mkdir -p ../fonts && cd ../fonts
for p in \
  "librebaskerville/LibreBaskerville%5Bwght%5D.ttf" librebaskerville/OFL.txt \
  shipporimincho/ShipporiMincho-Regular.ttf shipporimincho/ShipporiMincho-Bold.ttf shipporimincho/OFL.txt \
  "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" jetbrainsmono/OFL.txt \
  "mplus1code/MPLUS1Code%5Bwght%5D.ttf" mplus1code/OFL.txt \
  "archivo/Archivo%5Bwdth,wght%5D.ttf" archivo/OFL.txt \
  zenkakugothicnew/ZenKakuGothicNew-Regular.ttf zenkakugothicnew/ZenKakuGothicNew-Bold.ttf zenkakugothicnew/OFL.txt
do
  d=$(dirname "$p"); n=$(basename "$p" | sed 's/%5B/[/;s/%5D/]/')
  mkdir -p "$d"; curl -fsSL -o "$d/$n" "$G/$p"
done
