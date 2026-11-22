package co.hansora.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Saves a downloaded creation (image, video or audio) into the phone's gallery / music, in a "Hansora" folder.
 * Android's share sheet has no "Save to gallery", so app-shim.js calls this instead on Android 10+.
 * Android 10+ (API 29) uses MediaStore, which needs no storage permission. Older phones get an error,
 * and app-shim.js falls back to the share sheet.
 */
@CapacitorPlugin(name = "HansoraGallery")
public class GalleryPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String path = call.getString("path");
        String name = call.getString("name", "hansora-" + System.currentTimeMillis());
        String mime = call.getString("mime", "image/jpeg");
        if (path == null) { call.reject("path missing"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("unsupported"); return; }

        String file = path.startsWith("file://") ? Uri.parse(path).getPath() : path;
        Uri collection;
        String folder;
        if (mime.startsWith("video/")) {
            collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            folder = Environment.DIRECTORY_MOVIES;
        } else if (mime.startsWith("audio/")) {
            collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            folder = Environment.DIRECTORY_MUSIC;
        } else {
            collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            folder = Environment.DIRECTORY_PICTURES;
        }

        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder + "/Hansora");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri item = null;
        try {
            item = resolver.insert(collection, values);
            if (item == null) throw new Exception("insert failed");
            try (InputStream in = new FileInputStream(new File(file)); OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) throw new Exception("open failed");
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(item, values, null, null);
            JSObject ret = new JSObject();
            ret.put("uri", item.toString());
            call.resolve(ret);
        } catch (Exception e) {
            if (item != null) resolver.delete(item, null, null);
            call.reject("save failed: " + e.getMessage());
        }
    }
}
