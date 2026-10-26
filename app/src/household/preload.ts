import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("LocalHousehold", {
    call: (method: unknown, value: unknown) => ipcRenderer.invoke("household:local",method,value),
});

contextBridge.exposeInMainWorld("HouseholdNative", {
    openProfile: (request: unknown) => ipcRenderer.invoke("household:open-profile", request),
    rememberSession: (request: unknown) => ipcRenderer.invoke("household:remember", request),
    restoreSession: () => ipcRenderer.invoke("household:restore"),
    setServer: (value: unknown) => ipcRenderer.invoke("household:server", value),
});
