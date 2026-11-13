package space.makz.syndo.preview;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewAssetLoader;
import java.util.ArrayList;

/**
 * SEND for Android: a full-screen WebView around the hosted SEND app.
 * - Edge to edge: the page is padded by the real status bar, navigation bar and keyboard insets (Android 15 safe).
 * - Back closes the topmost sheet/menu/panel first (handled by the page via window.__sendBack), then returns
 *   to the channel list, and only then sends the app to the background.
 * - No privileged JavaScript bridge. App-level actions (reload latest, local preview, open in browser) are
 *   requested by the page as sendapp:// navigations, which only trigger those three harmless actions.
 */
public class MainActivity extends Activity {
    private static final String LOCAL = "https://appassets.androidplatform.net/index.html?preview=1";
    private static final int BG = Color.rgb(11, 16, 32); // SEND Glass bg0 (#0B1020)
    private WebView web;
    private ProgressBar progress;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> files;
    private final int MEDIA = 10, PICK_FILE = 11;

    private boolean trusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && (uri.getPort() == -1 || uri.getPort() == 443)
            && ("appassets.androidplatform.net".equals(uri.getHost()) || Uri.parse(BuildConfig.HOSTED_URL).getHost().equals(uri.getHost()));
    }
    private int dp(int n) { return Math.round(getResources().getDisplayMetrics().density * n); }
    private void browse(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (android.content.ActivityNotFoundException e) { Toast.makeText(this, "No browser is available.", Toast.LENGTH_SHORT).show(); }
    }
    private void openLive(boolean fresh) {
        getPreferences(MODE_PRIVATE).edit().putBoolean("hosted", true).apply();
        if (fresh) web.clearCache(true);
        web.loadUrl(BuildConfig.HOSTED_URL + "/?live=1" + (fresh ? "&build=" + System.currentTimeMillis() : ""));
    }
    /** sendapp://reload | sendapp://preview | sendapp://browser — app actions requested from Settings → About. */
    private boolean appAction(Uri uri) {
        if (!"sendapp".equals(uri.getScheme())) return false;
        String action = uri.getHost() == null ? "" : uri.getHost();
        switch (action) {
            case "reload": openLive(true); break;
            case "preview": getPreferences(MODE_PRIVATE).edit().putBoolean("hosted", false).apply(); web.loadUrl(LOCAL); break;
            case "browser": browse(Uri.parse(BuildConfig.HOSTED_URL)); break;
            default: break;
        }
        return true;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(BG));
        if (Build.VERSION.SDK_INT < 35) { getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(BG); }
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);

        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(BG);
        web = new WebView(this); web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); progress.setMax(100);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3)));
        setContentView(root);

        // Pad by the system bars and the keyboard so nothing sits under them; the composer rides on top of the keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        } else root.setFitsSystemWindows(true);

        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false); settings.setSafeBrowsingEnabled(true); settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SENDAndroid/" + BuildConfig.VERSION_NAME);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder().addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setDownloadListener((url, ua, disposition, mime, length) -> { Uri u = Uri.parse(url); if ("https".equals(u.getScheme())) browse(u); });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (req.isForMainFrame() && "appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html")); } catch (java.io.IOException e) { return null; }
                }
                return assets.shouldInterceptRequest(req.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (appAction(req.getUrl())) return true;
                if (trusted(req.getUrl())) return false;
                if (req.isForMainFrame() && req.hasGesture()) browse(req.getUrl()); return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame() && !"appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    Toast.makeText(MainActivity.this, "SEND is unreachable right now. Opening the offline preview.", Toast.LENGTH_LONG).show(); view.loadUrl(LOCAL);
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (req.isForMainFrame() && response.getStatusCode() >= 500 && !"appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    Toast.makeText(MainActivity.this, "SEND returned " + response.getStatusCode() + ". Opening the offline preview.", Toast.LENGTH_LONG).show(); view.loadUrl(LOCAL);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE); }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!trusted(request.getOrigin()) || !trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) { request.deny(); return; }
                    if (pendingPermission != null) pendingPermission.deny(); pendingPermission = request;
                    ArrayList<String> needed = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        String permission = PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) ? Manifest.permission.RECORD_AUDIO : PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) ? Manifest.permission.CAMERA : null;
                        if (permission != null && checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED && !needed.contains(permission)) needed.add(permission);
                    }
                    if (needed.isEmpty()) grantMedia(); else requestPermissions(needed.toArray(new String[0]), MEDIA);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (pendingPermission == request) pendingPermission = null; }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return false;
                if (files != null) files.onReceiveValue(null); files = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                // Respect the page's accept list (e.g. images only for avatars) so the picker shows the right files.
                ArrayList<String> types = new ArrayList<>();
                for (String t : params.getAcceptTypes()) if (t != null && t.contains("/")) types.add(t.trim());
                if (types.size() == 1) intent.setType(types.get(0));
                else { intent.setType(types.isEmpty() ? "*/*" : (types.stream().allMatch(t -> t.startsWith("image/")) ? "image/*" : "*/*")); if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0])); }
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK_FILE); } catch (android.content.ActivityNotFoundException e) { files.onReceiveValue(null); files = null; }
                return true;
            }
        });
        // Android 13+: system back (and Android 16's predictive back) arrives here, not in onBackPressed.
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        if (state == null) { if (getPreferences(MODE_PRIVATE).getBoolean("hosted", true)) openLive(false); else web.loadUrl(LOCAL); }
        else if (web.restoreState(state) == null) openLive(false);
    }
    private void grantMedia() {
        PermissionRequest request = pendingPermission; pendingPermission = null; if (request == null) return;
        if (!trusted(request.getOrigin()) || !trusted(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) { request.deny(); return; }
        ArrayList<String> granted = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) granted.add(resource);
        }
        if (granted.isEmpty()) request.deny(); else request.grant(granted.toArray(new String[0]));
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) { super.onRequestPermissionsResult(code, permissions, results); if (code == MEDIA) grantMedia(); }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == PICK_FILE && files != null) {
            ArrayList<Uri> selected = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) selected.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) selected.add(data.getData());
            }
            // Only document-provider URIs, never app-private file:// paths.
            selected.removeIf(uri -> !"content".equals(uri.getScheme()));
            files.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0])); files = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { goBack(); }
    private void goBack() {
        // Let the page close its topmost sheet/panel or go back to the channel list first.
        web.evaluateJavascript("(function(){try{return !!(window.__sendBack&&window.__sendBack())}catch(e){return false}})()", handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
        });
    }
    @Override protected void onDestroy() { if (pendingPermission != null) pendingPermission.deny(); if (files != null) files.onReceiveValue(null); web.destroy(); super.onDestroy(); }
}
