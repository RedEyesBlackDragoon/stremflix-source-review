import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { mainWindow } from '../../main';
import { join } from 'path';
import PluginOption from '../../interfaces/PluginSettingSchema';
import { ENHANCED_PLUGINS_API, FILE_EXTENSIONS } from '../../constants';
import Properties from '../../core/Properties';
import logger from '../../utils/logger';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const registeredPluginSchemas: Record<string, PluginOption[]> = {};

function assertCaller(event: IpcMainInvokeEvent): void {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame ||
        !event.senderFrame || new URL(event.senderFrame.url).origin !== 'https://web.stremio.com') {
        throw new Error('Untrusted settings caller');
    }
}

function configPath(name: unknown, extension: typeof FILE_EXTENSIONS.PLUGIN_CONFIG | typeof FILE_EXTENSIONS.PLUGIN = FILE_EXTENSIONS.PLUGIN_CONFIG): string {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(name) || name.includes('..')) throw new Error('Invalid plugin name');
    return join(Properties.pluginsPath, name + extension);
}

export function setupPluginSettingsAPI() {
    ipcMain.handle(ENHANCED_PLUGINS_API.GET_SETTING, (event, pluginFileName, key) => {
        assertCaller(event);
        let configFileExists = existsSync(configPath(pluginFileName));
        if(!configFileExists) {
            logger.warn(`No config found for plugin ${pluginFileName}`);
            writeFileSync(configPath(pluginFileName), JSON.stringify({}));
            return Promise.reject(new Error(`No config found (${pluginFileName}${FILE_EXTENSIONS.PLUGIN_CONFIG})!`));
        }

        let readConfig = readFileSync(configPath(pluginFileName), 'utf-8');
        let jsonConfig = JSON.parse(readConfig);

        return jsonConfig[key] ?? null;
    });

    ipcMain.handle(ENHANCED_PLUGINS_API.GET_SETTINGS, (event, pluginFileName) => {
        assertCaller(event);
        let configFileExists = existsSync(configPath(pluginFileName));
        if(!configFileExists) {
            logger.warn(`No config found for plugin ${pluginFileName}`);
            writeFileSync(configPath(pluginFileName), JSON.stringify({}));
            return Promise.reject(new Error(`No config found (${pluginFileName}${FILE_EXTENSIONS.PLUGIN_CONFIG})!`));
        }

        let readConfig = readFileSync(configPath(pluginFileName), 'utf-8');
        let jsonConfig = JSON.parse(readConfig);
        if(!jsonConfig) return {};

        return jsonConfig ?? {};
    });

    ipcMain.handle(ENHANCED_PLUGINS_API.SAVE_SETTING, (event, pluginFileName, key, value) => {
        assertCaller(event);
        if (typeof pluginFileName !== 'string' || typeof key !== 'string') return false;

        let configFileExists = existsSync(configPath(pluginFileName));
        if(!configFileExists) {
            logger.info(`No config found for plugin ${pluginFileName}. Creating new config file with setting ${key}.`);
            writeFileSync(configPath(pluginFileName), JSON.stringify({}));
        }

        let readConfig = readFileSync(configPath(pluginFileName), 'utf-8');

        let jsonConfig = JSON.parse(readConfig);
        if (!jsonConfig) jsonConfig = {};

        jsonConfig[key] = value;
        
        writeFileSync(configPath(pluginFileName), JSON.stringify(jsonConfig, null, 2));

        const channel = `${ENHANCED_PLUGINS_API.ON_SETTINGS_SAVED}:${pluginFileName}`;
        event.sender.send(channel, jsonConfig);

        return true;
    });

    ipcMain.handle(ENHANCED_PLUGINS_API.REGISTER_SETTINGS, (event, pluginFileName, pluginSchema) => {
        assertCaller(event);
        if (typeof pluginFileName !== 'string' || !Array.isArray(pluginSchema)) {
            logger.error("Invalid plugin options schema received. Expected an array of options.");
            return Promise.reject(new Error("Invalid plugin options schema. Ensure it follows the correct structure."));
        }

        let pluginFile = existsSync(configPath(pluginFileName, FILE_EXTENSIONS.PLUGIN));
        if(!pluginFile) {
            logger.error(`Plugin file not found for registering options: ${pluginFileName}${FILE_EXTENSIONS.PLUGIN}`);
            return Promise.reject(new Error("Plugin file not found."));
        }

        let configFileExists = existsSync(configPath(pluginFileName));
        if(!configFileExists) {
            logger.info(`No config found for plugin ${pluginFileName}. Creating new config file.`);
            writeFileSync(configPath(pluginFileName), JSON.stringify({}));
        }
        
        if(registeredPluginSchemas[configPath(pluginFileName)]) {
            return Promise.reject(`Plugin ${pluginFileName} already has a settings schema registered!`);
        }

        registeredPluginSchemas[configPath(pluginFileName)] = pluginSchema;
        logger.info(`Registered options for plugin ${pluginFileName}`);
        
        return true;
    });

    ipcMain.handle(ENHANCED_PLUGINS_API.CLEAR_REGISTERED_SETTINGS, (event, pluginFileName) => {
        assertCaller(event);
        if(registeredPluginSchemas[configPath(pluginFileName)]) {
            delete registeredPluginSchemas[configPath(pluginFileName)];
            return true;
        }

        return false;
    });

    ipcMain.handle(ENHANCED_PLUGINS_API.GET_REGISTERED_SETTINGS, (event, pluginFileName) => {
        assertCaller(event);
        if (typeof pluginFileName !== 'string') {
            logger.error("Invalid plugin file name received for getting options.");
            return Promise.reject("Invalid plugin file name.");
        }
        
        return registeredPluginSchemas[configPath(pluginFileName)] || null;
    });
}
