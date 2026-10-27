# AcadBro Android (TWA)

A Trusted Web Activity wrapper around https://acadbro-166c4.web.app. All UI lives in the web app (`../web`); this project only hosts it. Package `app.acadbro`.

## Run from Android Studio

1. **File > Open** and pick this `android/` folder (not the repo root).
2. Let Gradle sync. If asked, install **Android SDK Platform 36** and accept the Gradle/AGP prompts. Use the bundled JDK 17+ (Settings > Build Tools > Gradle > Gradle JDK).
3. Connect the phone (USB debugging on) or pick an emulator, choose the `app` configuration, press **Run**. Both the `debug` and `release` variants are signed with the AcadBro key, so either one matches the fingerprint in `web/.well-known/assetlinks.json` and opens **without a URL bar**.

## Signing

`app/build.gradle` reads `C:\Users\Sir\.acadbro-keys\keystore.properties` (keystore path, alias, passwords). That folder is outside the repo and holds the secrets; never copy them into the repo. If the file is missing, Gradle falls back to the default debug key and the app will show a URL bar (fingerprint mismatch).

SHA-256 of the signing certificate (public): `7B:C2:CD:01:B2:95:5D:F1:DF:94:76:78:68:C2:C5:02:A2:58:B0:78:A0:35:73:D8:99:81:09:D4:2E:AA:BE:54`

## If the URL bar still shows

- The web app's `/.well-known/assetlinks.json` must be live and list that fingerprint.
- Chrome caches the check: clear Chrome's data for the site or uninstall and reinstall the app.

## Notes

- This is a Bubblewrap project. Regenerating it (`bubblewrap update`) overwrites the signing block in `app/build.gradle`; re-apply it from git history.
- The same web app is also installable as a plain PWA from Chrome; the TWA just removes the browser chrome.
