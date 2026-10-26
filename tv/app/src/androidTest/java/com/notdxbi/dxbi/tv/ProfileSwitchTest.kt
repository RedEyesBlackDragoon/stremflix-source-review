package com.notdxbi.dxbi.tv

import android.content.Intent
import android.widget.Button
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProfileSwitchTest {
    @Test fun switchButtonReturnsToPickerWithoutRemovingViewerOrBinding() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val store=LocalProfileStore(context)
        val profile=store.create("Synthetic switch test","teal")
        val id=profile.getString("id")
        store.bind(id,"synthetic-switch-"+id)
        val scenario=ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java).putExtra("profileUuid",id).putExtra("localProfile",true))
        try {
            instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_MENU)
            scenario.onActivity { activity ->
                val button=activity.window.decorView.findViewWithTag<Button>("switch-profile")
                assertNotNull("Browsing must expose a visible switch control",button)
                assertTrue("Remote Menu must focus Switch Profile",button.hasFocus())
            }
            instrumentation.sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_CENTER)
            val deadline=System.currentTimeMillis()+5000
            while(scenario.state!=Lifecycle.State.DESTROYED && System.currentTimeMillis()<deadline){instrumentation.waitForIdleSync();Thread.sleep(50)}
            assertEquals(Lifecycle.State.DESTROYED,scenario.state)
            assertEquals("synthetic-switch-"+id,LocalProfileStore(context).profile(id).getString("accountId"))
        } finally {
            scenario.close()
            store.remove(id)
            instrumentation.runOnMainSync { ProfileCleanup.remove(context,id) }
        }
    }
}
