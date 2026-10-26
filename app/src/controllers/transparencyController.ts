import { ipcMain } from 'electron';
import { IPC_CHANNELS } from "../constants";
import logger from "../utils/logger";
import { writeFileSync, unlinkSync } from 'fs';
import Helpers from '../utils/Helpers';
    
// windowIsTransparent: how the window was actually created. The page asks this to decide whether to
// draw its own title bar; asking the flag file instead gave two title bars (the native frame plus the
// page's) whenever the file changed after the window was made, e.g. by the first launch's import.
export function setupWindowTransparency(transparencyFlagPath: string, windowIsTransparent: boolean) {
    ipcMain.on(IPC_CHANNELS.SET_TRANSPARENCY, (_, enabled: boolean) => {
        if (enabled) {
            logger.info("Enabled window transparency");
            writeFileSync(transparencyFlagPath, "1");
        } else {
            logger.info("Disabled window transparency");
            try {
                unlinkSync(transparencyFlagPath);
            } catch {
                // File may not exist, ignore
            }
        }
        
        Helpers.showAlert("info", "Transparency setting changed", "Please restart the app to apply the changes.", ["OK"]);
    });
    
    ipcMain.handle(IPC_CHANNELS.GET_TRANSPARENCY_STATUS, () => {
        return windowIsTransparent;
    });
}