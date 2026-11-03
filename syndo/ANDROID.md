# Syndo Android preview

The APK is a thin Android WebView shell, Android 8+ (API 26), packaged with the current web interface. It opens a **clearly labelled local preview** without needing an account or an API server. Sample conversations and actions stay on the device; they are never sent to the real API. Use real Syndo from the app menu once its API is deployed.

## Try it

Install `Syndo-preview.apk` from the **Syndo Android preview** workflow artifact. Open a sample DM or server, send local messages, use mentions, reactions, pins and saved messages, and explore Studio. Calls, uploads, account administration and other unimplemented preview actions explicitly require the live server.

The toolbar's **Update** button clears the WebView cache and opens `https://syndo.makz.space/?preview=1`, loading the latest published interface. When the host is unavailable, the app returns to its bundled preview with an explanation. This button updates hosted web content, not the Android shell itself. It does not silently install APKs. The app menu can return to the bundled preview or open live Syndo (`?live=1`). Preview data is separate from real accounts.

## Cloudflare updates

The existing repository's Cloudflare publish step currently skips: **`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are not set in GitHub Actions** (confirmed in the workflow logs). Add them under repository Settings → Secrets and variables → Actions. Do not commit their values. The token needs Pages deployment and R2 object-write access to the existing project/bucket.

With those secrets configured, pushing the selected Syndo branch runs checks and deploys `syndo-app` to its stable production URL. `SYNDO_PUBLISH_BRANCH` defaults to `codex/syndo-messaging-tools`; other branches deploy previews. The Android job also uploads the preview APK to `syndo-desktop/android/Syndo-preview.apk`. Default public download: `https://pub-77db39df34ad414fb86b513f573fd57e.r2.dev/android/Syndo-preview.apk` (available only after successful publishing).

Real accounts and calls additionally require the API/LiveKit deployment and the Pages `SYNDO_API_ORIGIN` variable described in DEPLOYMENT.md. A local preview is deliberately not a substitute for that deployment.

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
gradle assembleDebug -PsyndoAppUrl=https://syndo.makz.space
```

The app has no privileged JavaScript bridge. Navigation/media permissions are restricted to the configured HTTPS origin and bundled app-assets origin; file picking uses document-provider URIs, not app-private file paths. Camera and microphone are requested only when a page asks to use them. Native background calling, push notifications, screen sharing and Play Store distribution are not implemented by this preview shell.
