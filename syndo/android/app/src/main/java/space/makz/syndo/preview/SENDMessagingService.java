package space.makz.syndo.preview;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import android.os.Build;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/** Receives SEND's push messages and shows them: one notification per conversation, with the sender's avatar. */
public class SENDMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { MainActivity.tokenChanged(token); }

    @Override public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        String title = d.get("title"), body = d.get("body"), tag = d.get("tag"), url = d.get("url"), icon = d.get("icon");
        if (title == null || title.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        SENDApp.ensureChannel(this);
        String key = tag == null || tag.isEmpty() ? "send" : tag;
        Intent open = new Intent(this, MainActivity.class).putExtra("send_url", url == null ? "" : url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, key.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, SENDApp.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_send).setColor(0xFF3D6BFF)
            .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_MESSAGE).setAutoCancel(true).setContentIntent(tap).setShowWhen(true);
        Bitmap avatar = avatar(icon);
        if (avatar != null) b.setLargeIcon(avatar);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(key, 1, b.build());
    }

    /** The sender's avatar as a circle (only from SEND's own server), or null. */
    private Bitmap avatar(String icon) {
        if (icon == null || icon.isEmpty()) return null;
        String src = icon.startsWith("/") && !icon.startsWith("//") ? BuildConfig.HOSTED_URL + icon : icon;
        if (!src.startsWith(BuildConfig.HOSTED_URL + "/")) return null;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(src).openConnection();
            c.setConnectTimeout(4000); c.setReadTimeout(4000);
            try (InputStream in = c.getInputStream()) {
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw == null) return null;
                int size = Math.min(256, Math.min(raw.getWidth(), raw.getHeight()));
                Bitmap sq = Bitmap.createScaledBitmap(raw, size, size, true);
                Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                Paint p = new Paint(Paint.ANTI_ALIAS_FLAG); p.setShader(new BitmapShader(sq, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
                new Canvas(out).drawCircle(size / 2f, size / 2f, size / 2f, p);
                return out;
            }
        } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
    }
}
