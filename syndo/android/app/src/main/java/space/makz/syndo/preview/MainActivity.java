package space.makz.syndo.preview;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewAssetLoader;
import java.util.ArrayList;

/** Thin Android preview shell. Web updates are hosted; no privileged JavaScript bridge. */
public class MainActivity extends Activity {
    private static final String LOCAL = "https://appassets.androidplatform.net/index.html?preview=1";
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
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(14,14,13)); root.setFitsSystemWindows(true);
        LinearLayout bar = new LinearLayout(this); bar.setGravity(android.view.Gravity.CENTER_VERTICAL); bar.setPadding(dp(12),0,dp(4),0);
        TextView title = new TextView(this); title.setText("Syndo · preview"); title.setTextColor(Color.WHITE); title.setTextSize(17);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(52), 1)); title.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button update = new Button(this); update.setText("Update"); update.setTextColor(Color.rgb(247,186,0)); update.setContentDescription("Load latest Cloudflare preview");
        update.setOnClickListener(v -> { getPreferences(MODE_PRIVATE).edit().putBoolean("hosted", true).apply(); web.clearCache(true); web.loadUrl(BuildConfig.HOSTED_URL + "/?preview=1&build=" + System.currentTimeMillis()); });
        bar.addView(update);
        Button menu = new Button(this); menu.setText("⋮"); menu.setContentDescription("App menu"); bar.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48)));
        menu.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, menu);
            popup.getMenu().add("Local interface preview").setOnMenuItemClickListener(item -> { getPreferences(MODE_PRIVATE).edit().putBoolean("hosted", false).apply(); web.loadUrl(LOCAL); return true; });
            popup.getMenu().add("Open live Syndo").setOnMenuItemClickListener(item -> { web.loadUrl(BuildConfig.HOSTED_URL + "/?live=1"); return true; });
            popup.getMenu().add("Open in browser").setOnMenuItemClickListener(item -> { browse(Uri.parse(BuildConfig.HOSTED_URL)); return true; });
            popup.show();
        });
        root.addView(bar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); progress.setMax(100); root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setSafeBrowsingEnabled(true); settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder().addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (req.isForMainFrame() && "appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    try { return new WebResourceResponse("text/html", "UTF-8", getAssets().open("index.html")); } catch (java.io.IOException e) { return null; }
                }
                return assets.shouldInterceptRequest(req.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (trusted(req.getUrl())) return false;
                if (req.isForMainFrame() && req.hasGesture()) browse(req.getUrl()); return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame() && !"appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    Toast.makeText(MainActivity.this, "Hosted preview is unavailable. Opening the bundled preview.", Toast.LENGTH_LONG).show(); view.loadUrl(LOCAL);
                }
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (req.isForMainFrame() && response.getStatusCode() >= 400 && !"appassets.androidplatform.net".equals(req.getUrl().getHost())) {
                    Toast.makeText(MainActivity.this, "Cloudflare returned " + response.getStatusCode() + ". Opening the bundled preview.", Toast.LENGTH_LONG).show(); view.loadUrl(LOCAL);
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
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK_FILE); } catch (android.content.ActivityNotFoundException e) { files.onReceiveValue(null); files = null; }
                return true;
            }
        });
        if (state == null) web.loadUrl(getPreferences(MODE_PRIVATE).getBoolean("hosted", false) ? BuildConfig.HOSTED_URL + "/?preview=1" : LOCAL); else if (web.restoreState(state) == null) web.loadUrl(LOCAL);
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
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (pendingPermission != null) pendingPermission.deny(); if (files != null) files.onReceiveValue(null); web.destroy(); super.onDestroy(); }
}
