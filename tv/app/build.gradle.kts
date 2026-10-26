import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The TV app shares dx.bi's version number: it's read from the plugin at the repository root
val pluginFile = rootProject.file("../dxbi.plugin.js")
val dxbiVersion = Regex("""@version\s+([\d.]+)""").find(pluginFile.readText())!!.groupValues[1]
val versionParts = dxbiVersion.split(".").map { it.toInt() }

// Release signing: tv/keystore.properties (not in git) or the DXBI_TV_KEYSTORE* environment variables in CI
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? = keystoreProps.getProperty(key) ?: System.getenv(env)

android {
    namespace = "com.notdxbi.dxbi.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.dxbi.household.android"
        minSdk = 24
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionName = "0.1.11-local-tv"
        versionCode = 12
    }

    signingConfigs {
        create("release") {
            val store = signingValue("storeFile", "DXBI_TV_KEYSTORE")
            if (store != null) {
                storeFile = rootProject.file(store)
                storePassword = signingValue("storePassword", "DXBI_TV_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "DXBI_TV_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "DXBI_TV_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signingValue("storeFile", "DXBI_TV_KEYSTORE") != null) signingConfig = signingConfigs.getByName("release")
        }
        // For everyday use on the household TV: release speed (not debuggable, shrunk, compiled ahead of time)
        // but the debug key, so `adb install -r` over a debug build keeps every profile's sign-ins
        create("shield") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += "release"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // The built-in dx.bi plugin is the one at the repository root, copied in at build time
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/dxbiAssets"))
}

val copyPlugin by tasks.registering(Copy::class) {
    from(pluginFile, rootProject.file("../shared/stremio-adapter.js"), rootProject.file("../household/web/licenses.txt"))
    into(layout.buildDirectory.dir("generated/dxbiAssets"))
}
val copyLocalUI by tasks.registering(Copy::class) {
    from(rootProject.file("../shared/local"))
    into(layout.buildDirectory.dir("generated/dxbiAssets/local"))
}
tasks.named("preBuild") { dependsOn(copyPlugin,copyLocalUI) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.5.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.media3:media3-datasource-okhttp:1.5.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
