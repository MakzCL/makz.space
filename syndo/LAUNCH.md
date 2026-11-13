# SEND public launch checklist (MAKZ Labs)

Owner: MAKZ Labs, Office 1, Izabella House, 24-26 Regent Place, Birmingham, B1 3NJ, United Kingdom. Contact: send@makz.space.

## Done in the app

- Legal pages on send.makz.space: Terms, Privacy, Cookies, Community Guidelines, Copyright, Safety, Support, About, Brand, Company information, Status, Acknowledgements (452 open-source packages, all permissive or MPL-2.0, no GPL).
- Sign-up shows the Terms, Privacy and age 13+ notice. Settings, About links every policy and send@makz.space.
- In-app **Report** for messages, people and servers (stored in the `reports` table; emailed to send@makz.space once SMTP is configured).
- Block, data export, account deletion and two-factor login already existed.
- Licensed (branded) profile collections switched off: `shared/src/licensing.ts`, `LICENSED_COLLECTIONS_ENABLED = false`. 42 original collections remain. The server refuses branded ones.
- Deleting a message now also clears its link preview and forwarded copy.
- Logos made consistent with the desktop S (favicons, home-screen and PWA icons).
- send@makz.space created (Cloudflare Email Routing, forwards to the same inbox as business@makz.space).
- CI now also builds Windows x86 and ARM64, Linux (deb and AppImage) and macOS (Apple Silicon and Intel) as unsigned test artifacts.

## You need to do (cannot be done from code)

1. **Solicitor review** of Terms and Privacy before launch. They are written to UK law and the Online Safety Act, but a UK tech lawyer should sign them off (a fixed-fee review is common).
2. **ICO data protection fee**: organisations processing personal data must register with the ICO (tier 1 is about £52 a year). Add the registration number to /company.
3. **Company details**: if MAKZ Labs is a limited company, add its Companies House number and registered office to /company and the Terms. If it's a sole trader trading name, say so (Apple and Google show the legal name).
4. **EU users**: if you actively offer SEND in the EU, appoint an EU GDPR representative (Article 27) and add it to the Privacy Policy.
5. **Online Safety Act**: complete and keep an illegal content risk assessment and a children's access assessment (Ofcom guidance), and name a person accountable for safety. Decide who reviews the `reports` table and how fast.
6. **Logo font licence**: the SEND logo uses "Dimitri" by Fontalicious under a personal-use licence. Buy a commercial licence (licensing@fontalicious.com) or have the wordmark redrawn before commercial launch.
7. **Sending email from send@makz.space**: receiving works now. To send as that address, add it as a "Send mail as" address in Gmail via an SMTP provider (Cloudflare does not send). Configure the server's SMTP so password resets and report alerts send.
8. **Trade mark**: search the UK IPO and EUIPO registers for "SEND" in class 9 and 38 before investing in the name; "send" is a common word and may be hard to register alone.

## Windows signing (no "unknown publisher" warning)

- **Cheapest route: Azure Artifact Signing** (formerly Trusted Signing). About US$9.99 a month (Basic, 5,000 signatures). Open to UK organisations; needs a paid Azure subscription and identity validation of MAKZ Labs (legal name must match Companies House). Works with Tauri signing.
- **Alternative: OV code-signing certificate** from Sectigo, DigiCert or SSL.com, roughly £150 to £400 a year, now issued on a hardware token or cloud HSM.
- **EV is no longer worth paying extra for**: since 2024 EV certificates do not get instant SmartScreen trust. With any certificate, the warning fades as downloads build reputation.
- **Microsoft Store**: free for companies since May 2026. Store-installed apps never show the SmartScreen warning, so publishing there is worth doing as well.

## App stores

- **Android app (done in code)**: `syndo/android`, app id `space.makz.send`, version 0.7.1, targets Android 16 (API 36), adaptive icon, splash, predictive back. CI builds the APK (sideload, served at /api/downloads/android) and a Play bundle (`SEND-play.aab`).
  - **Create a release signing key once and keep it safe forever** (losing it means you can never update the Play listing): `keytool -genkeypair -v -keystore send-release.jks -alias send -keyalg RSA -keysize 4096 -validity 10000`. Add GitHub repository secrets `SEND_ANDROID_KEYSTORE_B64` (`base64 -w0 send-release.jks`), `SEND_ANDROID_KEYSTORE_PASSWORD`, `SEND_ANDROID_KEY_ALIAS` (`send`) and `SEND_ANDROID_KEY_PASSWORD`. Until then every CI build gets a different debug key, so a new APK cannot install over an older one (uninstall first).
  - Optional: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets so CI publishes the APK to the download link itself.
  - The app id changed from the old preview (`space.makz.syndo.preview`), so testers should uninstall the old "SEND" app.
- **Google Play**: one-off US$25. New personal accounts must run a closed test with at least 12 testers for 14 days; organisation accounts skip that but need a D-U-N-S number. Fill in the Data safety form to match the Privacy Policy. Use Play App Signing and upload `SEND-play.aab`.
- **iOS app (done in code)**: `syndo/ios`, a native WKWebView app (bundle id `space.makz.send`, iOS 16+, iPhone and iPad). Generate with `brew install xcodegen && xcodegen generate` on a Mac, open `SEND.xcodeproj`, set your Team, run. CI builds an unsigned IPA (artifact `send-ios-unsigned`) you can sign and install with Sideloadly or AltStore using a free Apple ID (re-sign every 7 days).
- **Apple App Store**: Apple Developer Program, US$99 a year; needs a D-U-N-S number for an organisation account. Then archive in Xcode and upload to TestFlight. Requirements met: report, block, Terms acceptance, account deletion in app, privacy policy URL. Still to do: App Privacy "nutrition label" answers (match the Privacy Policy), age rating, the export compliance question (SEND uses standard encryption only). Apple's guideline 4.2 rejects apps that are "just a website": SEND's app adds calls, camera, downloads and offline handling, but native push notifications (APNs) would make approval much more likely and are the next step.
- **Push notifications**: browsers (desktop, Android Chrome, iPhone home-screen app) work now. The apps have all the code; each needs its free push service connected once:
  - **Android (Firebase, free)**:
    1. console.firebase.google.com, Add project "SEND" (Google Analytics can be off).
    2. Add an Android app with package name `space.makz.send` (skip the google-services.json download).
    3. Project settings, General, Your apps: copy the App ID, Web API key, Project ID and Project number.
    4. GitHub repo, Settings, Secrets and variables, Actions, **Variables**: add `SEND_FCM_APP_ID`, `SEND_FCM_API_KEY`, `SEND_FCM_PROJECT_ID`, `SEND_FCM_SENDER_ID` (the Project number). These are public values.
    5. Project settings, Service accounts, Generate new private key. In Cloudflare: Workers, `send-beta-api`, Settings, Variables and Secrets, add a **Secret** `SEND_FCM_SERVICE_ACCOUNT` and paste the whole JSON file. Never commit or share this file.
    6. Re-run the "SEND Android beta" workflow and install the new APK.
  - **iOS (Apple push, needs the paid Apple Developer account)**: developer.apple.com, Certificates, Identifiers and Profiles, Keys, add a key with Apple Push Notifications service. Download the `.p8` (only once) and note its Key ID and your Team ID. Add Cloudflare secrets `SEND_APNS_KEY` (the file's contents), `SEND_APNS_KEY_ID` and `SEND_APNS_TEAM_ID`. In Xcode, set your Team and add the Push Notifications capability (the entitlements file is already there).
  - After adding secrets the backend restarts on its own within a minute or two.
- **Linux and macOS desktop**: CI builds them now. macOS distribution outside the App Store needs Developer ID signing and notarisation (included in the US$99 programme).

## Connections (linking other accounts to a profile)

Safe to build for a global commercial app (check each provider's current terms at build time):

- **Steam** (OpenID sign-in plus Web API): allowed in apps; use Valve's official "Sign in through Steam" button; 100,000 calls a day; personal API key responsibility.
- **Twitch** (OAuth, Helix API): allowed under the Twitch Developer Agreement; show only data users authorise; follow brand rules.
- **YouTube** (Google OAuth, YouTube Data API): allowed under YouTube API Services Terms; Google OAuth verification required for sensitive scopes; default 10,000 units a day.
- **GitHub** (OAuth): allowed, generous limits.
- **Bluesky** (AT Protocol OAuth): open protocol, allowed.
- **Battle.net** (OAuth): available through Blizzard's developer portal; check its commercial terms.
- **Epic Games** (Epic Account Services): free via Epic Online Services, requires app approval.
- **Riot Games** (Riot Sign On): needs a production key and approved product registration.
- **Xbox** (Microsoft identity with Xbox profile scope): basic gamertag linking is possible; deeper Xbox Live data needs Microsoft partner approval.
- **Reddit**: commercial use needs a paid or approved agreement since 2023.
- **Facebook and Instagram**: Facebook Login needs app review; the Instagram Basic Display API was shut down in December 2024, so personal Instagram linking is no longer possible.

Hard or unrealistic right now:

- **Spotify**: since 15 May 2025, extended Web API access only goes to registered organisations with an established commercial service (third parties report a 250,000 monthly-user minimum). Without it an app is capped at a handful of allow-listed users, so "Listening on Spotify" for everyone isn't currently possible for a new app.
- **PlayStation**: no public API.
- **X (Twitter)**: paid tiers only, expensive for this use.
- **TikTok**: Login Kit needs app review.

Store only the account ID and display name, let users remove a connection at any time, and list each connected service in the Privacy Policy when you add it.
