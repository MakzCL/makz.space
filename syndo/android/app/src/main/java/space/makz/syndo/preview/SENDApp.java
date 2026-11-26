package space.makz.syndo.preview;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

/** Starts Firebase from build settings (no google-services.json needed); push stays off when they're empty. */
public class SENDApp extends Application {
    static final String CHANNEL = "messages";
    static boolean pushConfigured() { return !BuildConfig.FCM_APP_ID.isEmpty() && !BuildConfig.FCM_API_KEY.isEmpty() && !BuildConfig.FCM_PROJECT_ID.isEmpty(); }

    @Override public void onCreate() {
        super.onCreate();
        if (pushConfigured() && FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(this, new FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FCM_APP_ID).setApiKey(BuildConfig.FCM_API_KEY)
                .setProjectId(BuildConfig.FCM_PROJECT_ID).setGcmSenderId(BuildConfig.FCM_SENDER_ID).build());
        }
        ensureChannel(this);
    }

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Direct messages, mentions and replies");
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }
}
