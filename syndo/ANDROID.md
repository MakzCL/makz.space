# SEND for Android

**Download:** `https://syndo.makz.space/api/downloads/android`. This redirects to the current `SEND.apk` in the public `syndo-desktop` R2 bucket (`android/SEND.apk`). The old `/android/SEND-preview.apk` and `/android/SEND-beta.apk` links redirect there too. Android browsers get a one-time "Get SEND for Android" prompt.

**Publishing a new APK:** the `SEND Android beta` workflow builds it on every push to the SEND branch and keeps it as a 90-day artifact. Uploading to R2 is automatic once `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set as repository secrets (the workflow's R2 step writes `android/SEND-beta.apk`; change its key to `android/SEND.apk`). Until then, upload the artifact's APK to `syndo-desktop/android/SEND.apk` by hand.

The APK (v0.3.0) is a full-screen Android WebView around the hosted SEND app at `https://syndo.makz.space`. Android 8+ (API 26) is supported. Interface updates arrive without reinstalling. An offline preview with sample data is bundled for when the server can't be reached.

## What's native

- **Edge to edge.** The page is padded by the real status bar, navigation bar, display cutout and keyboard insets, so nothing sits under system bars. The message box rides on top of the keyboard. This handles Android 15's forced edge-to-edge too.
- **Back button / gesture.**
  1. Closes the topmost sheet, menu, dialog or panel.
  2. Then returns from a conversation to the channel list.
  3. Then sends the app to the background (it doesn't close it).
- **Haptics.** A short vibration confirms a long-press.
- **File picking.** Pickers respect what the page asks for (images only for avatars and banners). Only document-provider `content://` URIs are passed in.
- **Camera and microphone.** These are requested only when a call asks for them, and only for the SEND origin.
- **App actions.** Settings → About → *Android app* has "Reload latest version", "Open in browser" and "Offline preview". The page asks for these with `sendapp://` links, which can only trigger those three actions. There is no JavaScript bridge.

## Phone interface (same code as the web app)

- **Two screens, like Discord mobile.** The channel list (servers + channels/DMs) and the conversation. Swipe right or tap ☰ for the list; swipe left or pick a channel to return.
- **Long-press = right-click.** Messages, people, channels and servers open bottom action sheets with 48px rows. Emoji reactions show as a big grid.
- **Full-screen pages for members, pins, search and conversation appearance.** Settings open on a section list, and each section is full screen with "‹ All settings".
- **Bottom sheets for menus, the emoji picker, profile cards and dialogs.** Inputs are 16px so the page never zooms on focus.
- **Verified by `e2e/mobile.cjs`** on Pixel 7 and iPhone SE sizes (52 checks): no horizontal overflow, nothing covering the message box, header buttons ≥40px, sheets anchored to the screen bottom, back-button order, swipe navigation, and settings without clipped fields.

## Not yet native

Push notifications while the app is closed, background calls (a call ends when Android suspends the app), screen sharing from Android, and Play Store distribution. Downloads of encrypted attachments must be saved from the in-app viewer; `blob:` URLs can't be handed to Android's download manager.

## Cloudflare updates

The connected Cloudflare account can publish this project directly, using the existing authenticated connection and a short-lived, project-specific Pages upload authorization. No account-wide deployment token is needed for these publishes. The interface and the APK download are hosted together at `https://syndo.makz.space`; preview mode is available at `/channels/@me?preview=1`, and the APK at `/android/SEND-preview.apk`. Preview navigation retains its explicit opt-in query parameter so shared links and reloads stay in preview mode.

The optional, unattended **GitHub Actions** publishing steps still skip while `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are absent from repository secrets. This does not block direct publishes through the connected Cloudflare account. Never commit credentials. No new account-wide R2 write token was created.

If GitHub publishing secrets are configured later, pushing the selected SEND branch runs checks and deploys `syndo-app` to its stable production URL. `SEND_PUBLISH_BRANCH` defaults to `codex/syndo-messaging-tools`; other branches deploy previews. The optional Android R2 step uses `syndo-desktop/android/SEND-preview.apk`; that separate R2 feed is not required for the APK's hosted-interface Update button.

Real accounts and calls additionally require the API/LiveKit deployment and the Pages `SEND_API_ORIGIN` variable described in DEPLOYMENT.md. A local preview is deliberately not a substitute for that deployment.

## Build

CI uses Java 17, Gradle 8.11.1, Android Gradle Plugin 8.9.1 and SDK 35. It runs the web checks, bundles `web/dist` into Android assets, builds `assembleDebug` and uploads the APK. No private signing key or service credentials are shipped in the app. A debug key makes this an installable preview, not a Play Store release; future Android shell upgrades need a persistent signing setup. Hosted interface updates do not need a new APK.

For a local build with that SDK/Gradle installed:

```sh
cd syndo
npm ci
npm run build
mkdir -p android/app/src/main/assets
cp -R web/dist/. android/app/src/main/assets/
cd android
gradle assembleDebug -PsendAppUrl=https://syndo.makz.space
```

The app has no privileged JavaScript bridge. Navigation/media permissions are restricted to the configured HTTPS origin and bundled app-assets origin; file picking uses document-provider URIs, not app-private file paths. Camera and microphone are requested only when a page asks to use them. Native background calling, push notifications, screen sharing and Play Store distribution are not implemented by this preview shell.
