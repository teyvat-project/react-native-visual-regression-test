package com.natsuneko.vrt

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import android.view.View
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.UIManagerHelper
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

class VrtCaptureModule(reactContext: ReactApplicationContext) : NativeVrtCaptureSpec(reactContext) {
  private val encoder = Executors.newSingleThreadExecutor()

  override fun invalidate() {
    encoder.shutdown()
    super.invalidate()
  }

  override fun capture(reactTag: Double, promise: Promise) {
    val tag = reactTag.toInt()
    UiThreadUtil.runOnUiThread {
      try {
        captureOnUiThread(tag, promise)
      } catch (error: Exception) {
        promise.reject("E_CAPTURE", error.message ?: "VRT capture failed", error)
      }
    }
  }

  private fun captureOnUiThread(tag: Int, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.reject("E_API", "VRT capture requires Android 8.0 (API 26) or later")
      return
    }
    val view = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag)?.resolveView(tag)
    if (view == null || !view.isAttachedToWindow) {
      promise.reject("E_VIEW", "VRT target view $tag is not mounted in a window")
      return
    }
    if (view.width <= 0 || view.height <= 0) {
      promise.reject("E_SIZE", "VRT target view has zero size (${view.width}x${view.height})")
      return
    }

    val location = IntArray(2)
    view.getLocationInWindow(location)
    val rect = Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
    val root = view.rootView
    if (rect.left < 0 || rect.top < 0 || rect.right > root.width || rect.bottom > root.height) {
      promise.reject(
        "E_OFFSCREEN",
        "VRT target view $rect is not fully inside its window (${root.width}x${root.height}). " +
          "Android captures what is on screen, so keep the element fully visible."
      )
      return
    }

    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    val onCopied = { status: Int ->
      if (status == PixelCopy.SUCCESS) {
        encode(bitmap, promise)
      } else {
        bitmap.recycle()
        promise.reject("E_PIXEL_COPY", "PixelCopy failed with status $status")
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Copies from the window the view is attached to, which also covers Modal and other dialogs.
      val request = PixelCopy.Request.Builder.ofWindow(view)
        .setSourceRect(rect)
        .setDestinationBitmap(bitmap)
        .build()
      PixelCopy.request(request, { it.run() }) { result -> onCopied(result.status) }
    } else {
      val activity = reactApplicationContext.currentActivity
      if (activity == null || !isInActivityWindow(view, activity)) {
        bitmap.recycle()
        promise.reject(
          "E_WINDOW",
          "VRT target view is not in the activity window. Capturing views inside Modal requires Android 14 (API 34) or later."
        )
        return
      }
      PixelCopy.request(activity.window, rect, bitmap, { status -> onCopied(status) }, Handler(Looper.getMainLooper()))
    }
  }

  private fun isInActivityWindow(view: View, activity: Activity): Boolean =
    view.rootView === activity.window?.decorView

  private fun encode(bitmap: Bitmap, promise: Promise) {
    encoder.execute {
      try {
        val output = ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
          promise.reject("E_PNG", "VRT failed to encode PNG")
          return@execute
        }
        promise.resolve(Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
      } catch (error: Exception) {
        promise.reject("E_PNG", error.message ?: "VRT failed to encode PNG", error)
      } finally {
        bitmap.recycle()
      }
    }
  }

  companion object {
    const val NAME = NativeVrtCaptureSpec.NAME
  }
}
