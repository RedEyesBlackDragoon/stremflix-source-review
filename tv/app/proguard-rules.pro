# The page calls these through the JavaScript bridge
-keepclassmembers class com.notdxbi.dxbi.tv.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
