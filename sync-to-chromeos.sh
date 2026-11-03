#!/bin/sh
# Chrome keeps an unpacked extension across restarts only if it lives in "My files":
# Linux files aren't mounted yet when Chrome starts. This copies the extension there.
set -e
SHARE=/mnt/chromeos/MyFiles/Downloads
DEST="$SHARE/one-voice-chrome-extension"
if [ ! -d "$SHARE" ]; then
  echo "First share Downloads with Linux: Files app → right-click Downloads → Share with Linux." >&2
  exit 1
fi
cd "$(dirname "$0")"
mkdir -p "$DEST"
cp -r manifest.json ./*.js ./*.html icons "$DEST/"
echo "Copied to My files › Downloads › one-voice-chrome-extension. Press ⟳ on ONE voice in chrome://extensions."
