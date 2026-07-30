#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLEAN_PATH=/usr/bin:/bin:/usr/sbin:/sbin
ARCHIVE_PATH="$ROOT/build/TopmanWorldMonitor.xcarchive"
EXPORT_PATH="$ROOT/build/export-testflight"

echo "Generating Xcode project…"
xcodegen generate

echo "Archiving TOPMANIDMB World Monitor…"
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH"
xcodebuild \
  -project TopmanWorldMonitor.xcodeproj \
  -scheme TopmanWorldMonitor \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  archive \
  -allowProvisioningUpdates

echo "Uploading to App Store Connect…"
env PATH="$CLEAN_PATH" xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist "$ROOT/AppStore/ExportOptions-Upload.plist" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates

echo "Upload submitted. Verify processing and tester availability in App Store Connect."

