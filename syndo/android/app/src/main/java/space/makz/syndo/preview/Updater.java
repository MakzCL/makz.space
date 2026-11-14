package space.makz.syndo.preview;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;

/**
 * In-app updates for the sideloaded APK.
 *
 * CI publishes the signed APK to SEND's public release bucket under an immutable name, then a small version.json
 * (versionCode, versionName, url, sha256, size, notes). The app checks it on launch (at most every 6 hours) and from
 * Settings, offers the update, downloads it with progress, and only installs it if:
 *  - it comes over https from the release bucket,
 *  - its SHA-256 matches version.json,
 *  - it is SEND (same package) with a higher version code, signed with the same key as the installed app.
 * Android's own installer then asks the person to confirm. Nothing installs silently.
 */
final class Updater {
    private static final long AUTO_EVERY_MS = 6 * 3600_000L;
    private final Activity activity;
    private final SharedPreferences prefs;
    private File pendingApk;
    private boolean busy;

    Updater(Activity activity) { this.activity = activity; this.prefs = activity.getSharedPreferences("updates", Context.MODE_PRIVATE); }

    /** Automatic check on launch: quiet, throttled, and silent when there's nothing new. */
    void checkAutomatically() {
        long last = prefs.getLong("lastCheck", 0);
        if (System.currentTimeMillis() - last < AUTO_EVERY_MS) return;
        check(false);
    }

    /** From Settings: always checks and always says what happened. */
    void checkNow() { check(true); }

    /** Called from onResume: continue an install that was waiting for "Install unknown apps" permission. */
    void resume() {
        if (pendingApk != null && canInstall()) { File apk = pendingApk; pendingApk = null; install(apk); }
    }

    private void check(boolean manual) {
        if (busy) { if (manual) toast("Already checking for updates."); return; }
        busy = true;
        if (manual) toast("Checking for updates…");
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(readText(BuildConfig.UPDATE_URL + "?t=" + System.currentTimeMillis()));
                prefs.edit().putLong("lastCheck", System.currentTimeMillis()).apply();
                int code = v.getInt("versionCode");
                String name = v.optString("versionName", String.valueOf(code));
                if (code <= BuildConfig.VERSION_CODE) { busy = false; if (manual) toast("SEND is up to date (version " + BuildConfig.VERSION_NAME + ")."); return; }
                if (!manual && prefs.getInt("skipped", -1) == code && System.currentTimeMillis() - prefs.getLong("skippedAt", 0) < 24 * 3600_000L) { busy = false; return; }
                activity.runOnUiThread(() -> offer(v, code, name));
            } catch (Exception e) {
                busy = false;
                if (manual) toast("Couldn't check for updates. Check your connection and try again.");
            }
        }).start();
    }

    private void offer(JSONObject v, int code, String name) {
        if (activity.isFinishing()) { busy = false; return; }
        String notes = v.optString("notes", "").trim();
        long size = v.optLong("size", 0);
        String msg = "SEND " + name + " is ready. You have " + BuildConfig.VERSION_NAME + "."
            + (size > 0 ? "\n\nDownload size: " + Math.max(1, Math.round(size / 1048576.0)) + " MB." : "")
            + (notes.isEmpty() ? "" : "\n\n" + notes);
        new AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(msg)
            .setNegativeButton("Later", (d, w) -> { prefs.edit().putInt("skipped", code).putLong("skippedAt", System.currentTimeMillis()).apply(); busy = false; })
            .setPositiveButton("Update", (d, w) -> download(v, code))
            .setOnCancelListener(d -> busy = false)
            .show();
    }

    private void download(JSONObject v, int code) {
        String url = v.optString("url", ""), sha = v.optString("sha256", "").toLowerCase();
        Uri u = Uri.parse(url), manifest = Uri.parse(BuildConfig.UPDATE_URL);
        if (!"https".equals(u.getScheme()) || u.getHost() == null || !u.getHost().equals(manifest.getHost()) || !sha.matches("[0-9a-f]{64}")) {
            busy = false; error("This update's details look wrong, so it wasn't downloaded."); return;
        }
        LinearLayout box = new LinearLayout(activity); box.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(activity.getResources().getDisplayMetrics().density * 20); box.setPadding(pad, pad / 2, pad, 0);
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal); bar.setMax(100);
        TextView label = new TextView(activity); label.setText("Starting download…");
        box.addView(bar); box.addView(label);
        final boolean[] cancelled = { false };
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Downloading update").setView(box).setCancelable(false)
            .setNegativeButton("Cancel", (d, w) -> cancelled[0] = true).show();
        new Thread(() -> {
            File dir = new File(activity.getCacheDir(), "updates"); dir.mkdirs();
            for (File old : dir.listFiles() == null ? new File[0] : dir.listFiles()) old.delete();
            File apk = new File(dir, "SEND-" + code + ".apk");
            try {
                HttpURLConnection c = open(url);
                long total = c.getContentLengthLong(), done = 0;
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024]; int n; int lastPct = -1;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled[0]) throw new InterruptedException();
                        out.write(buf, 0, n); md.update(buf, 0, n); done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : 0;
                        if (pct != lastPct) { lastPct = pct; final long d2 = done; activity.runOnUiThread(() -> { bar.setProgress(pct); label.setText((d2 / 1048576) + " MB" + (total > 0 ? " of " + (total / 1048576) + " MB" : "")); }); }
                    }
                }
                String got = hex(md.digest());
                if (!got.equals(sha)) throw new SecurityException("checksum");
                String problem = verify(apk, code);
                activity.runOnUiThread(() -> {
                    dialog.dismiss(); busy = false;
                    if (problem != null) { apk.delete(); if ("signature".equals(problem)) signatureChanged(); else error(problem); return; }
                    if (canInstall()) install(apk); else askInstallPermission(apk);
                });
            } catch (InterruptedException e) {
                apk.delete(); activity.runOnUiThread(() -> { dialog.dismiss(); busy = false; });
            } catch (SecurityException e) {
                apk.delete(); activity.runOnUiThread(() -> { dialog.dismiss(); busy = false; error("The download didn't match the published update, so it wasn't installed. Try again later."); });
            } catch (Exception e) {
                apk.delete(); activity.runOnUiThread(() -> { dialog.dismiss(); busy = false; error("The update couldn't be downloaded. Check your connection and try again."); });
            }
        }).start();
    }

    /** Same package, the expected version, signed by the same key as this install. Returns a problem, or null. */
    @SuppressWarnings("deprecation")
    private String verify(File apk, int code) {
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getPath(), flags);
        if (archive == null) return "The downloaded file isn't a valid app.";
        if (!activity.getPackageName().equals(archive.packageName)) return "The downloaded file isn't SEND.";
        long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (archiveCode != code || archiveCode <= BuildConfig.VERSION_CODE) return "The downloaded file isn't the expected version.";
        try {
            PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
            if (!Arrays.equals(signatures(installed), signatures(archive))) return "signature";
        } catch (PackageManager.NameNotFoundException e) { return "SEND's own details couldn't be read."; }
        return null;
    }
    @SuppressWarnings("deprecation")
    private static byte[][] signatures(PackageInfo p) {
        Signature[] s = Build.VERSION.SDK_INT >= 28 && p.signingInfo != null
            ? (p.signingInfo.hasMultipleSigners() ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory())
            : p.signatures;
        if (s == null) return new byte[0][];
        byte[][] out = new byte[s.length][];
        for (int i = 0; i < s.length; i++) out[i] = s[i].toByteArray();
        Arrays.sort(out, Updater::compareBytes);
        return out;
    }

    private static int compareBytes(byte[] a, byte[] b) {
        for (int i = 0; i < Math.min(a.length, b.length); i++) { int d = (a[i] & 0xff) - (b[i] & 0xff); if (d != 0) return d; }
        return a.length - b.length;
    }

    private boolean canInstall() { return activity.getPackageManager().canRequestPackageInstalls(); }

    private void askInstallPermission(File apk) {
        pendingApk = apk;
        new AlertDialog.Builder(activity)
            .setTitle("Allow SEND to install updates")
            .setMessage("Android asks you to allow this once. Turn on \"Allow from this source\" for SEND, then come back and the update will continue.")
            .setNegativeButton("Not now", (d, w) -> pendingApk = null)
            .setPositiveButton("Open settings", (d, w) -> {
                try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
                catch (Exception e) { pendingApk = null; error("Open Settings, Apps, SEND, Install unknown apps, and allow it."); }
            })
            .show();
    }

    private void install(File apk) {
        try {
            PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            params.setSize(apk.length());
            int id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("SEND.apk", 0, apk.length())) {
                    byte[] buf = new byte[64 * 1024]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent done = new Intent(activity, InstallResult.class);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pi = PendingIntent.getBroadcast(activity, id, done, flags);
                session.commit(pi.getIntentSender());
            }
        } catch (Exception e) {
            error("The update couldn't be installed: " + e.getMessage());
        }
    }

    private void signatureChanged() {
        new AlertDialog.Builder(activity)
            .setTitle("One-time reinstall needed")
            .setMessage("This version of SEND is signed with SEND's new release key, so Android can't install it over the copy you have. "
                + "Uninstall SEND, then install the new version from the download page. You'll need to sign in again. After this, updates install from inside the app.")
            .setNegativeButton("Later", null)
            .setPositiveButton("Open download page", (d, w) -> {
                try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.HOSTED_URL + "/api/downloads/android"))); } catch (Exception ignored) { }
            })
            .show();
    }

    private void toast(String s) { activity.runOnUiThread(() -> Toast.makeText(activity, s, Toast.LENGTH_SHORT).show()); }
    private void error(String s) {
        activity.runOnUiThread(() -> { if (!activity.isFinishing()) new AlertDialog.Builder(activity).setTitle("Update").setMessage(s).setPositiveButton("OK", null).show(); });
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(false); c.setUseCaches(false);
        c.setRequestProperty("cache-control", "no-cache");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        return c;
    }
    private static String readText(String url) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            byte[] all = new byte[64 * 1024]; int len = 0, n;
            while ((n = in.read(all, len, all.length - len)) > 0) { len += n; if (len == all.length) throw new Exception("too large"); }
            return new String(all, 0, len, "UTF-8");
        }
    }
    private static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }
}
