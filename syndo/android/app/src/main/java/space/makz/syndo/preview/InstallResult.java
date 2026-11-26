package space.makz.syndo.preview;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Result of an in-app update install: shows Android's confirmation screen, or says why it failed. */
public class InstallResult extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) { confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); try { context.startActivity(confirm); } catch (Exception ignored) { } }
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) return; // the app restarts on the new version
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) return; // the person tapped Cancel
        String why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        Toast.makeText(context, "SEND update wasn't installed" + (why != null && !why.isEmpty() ? ": " + why : "."), Toast.LENGTH_LONG).show();
    }
}
