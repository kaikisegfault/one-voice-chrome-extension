#!/bin/sh
# Chrome keeps an unpacked extension across restarts only if it lives in "My files":
# Linux files aren't mounted yet when Chrome starts. This copies the extension there.
set -e
SHARE=/mnt/chromeos/MyFiles/shared-with-linux
DEST="$SHARE/one-voice-chrome-extension"
if [ ! -d "$SHARE" ]; then
  echo "Create My files › shared-with-linux and share it with Linux (Files app → right-click → Share with Linux)." >&2
  exit 1
fi
cd "$(dirname "$0")"
mkdir -p "$DEST"
cp -r manifest.json ./*.js ./*.html icons "$DEST/"
echo "Copied to My files › shared-with-linux › one-voice-chrome-extension. Press ⟳ on ONE voice in chrome://extensions."
