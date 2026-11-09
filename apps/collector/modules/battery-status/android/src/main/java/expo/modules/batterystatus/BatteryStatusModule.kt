package expo.modules.batterystatus

import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BatteryStatusModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("BatteryStatus")

    Function("isIgnoringBatteryOptimizations") {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // 0 means unknown: getAppStandbyBucket needs API 28.
    Function("standbyBucket") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
        0
      } else {
        val usage = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        usage.appStandbyBucket
      }
    }
  }
}
