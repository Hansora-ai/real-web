#!/bin/bash
# Double-click to get the newest Hansora app into Xcode: updates the project, prepares the iPhone project, opens Xcode.
cd "$(dirname "$0")" || exit 1
echo "Getting the newest version…"
git pull --ff-only 2>/dev/null || echo "(If this didn't update: click 'Pull origin' in GitHub Desktop, then run this again.)"
echo "Preparing the app…"
npm install --no-audit --no-fund --loglevel=error && npx cap sync ios && npx cap open ios
echo ""
echo "Done. In Xcode, press ▶ to run the app. You can close this window."
