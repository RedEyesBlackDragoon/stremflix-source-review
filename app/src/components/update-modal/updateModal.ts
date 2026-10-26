import { marked } from "marked";
import TemplateCache from "../../utils/templateCache";

export async function getUpdateModalTemplate(currentVersion: string, latestVersion: string, releaseNotes: string): Promise<string> {
    let template = TemplateCache.load(__dirname, 'update-modal');
    
    const markdown = await marked(releaseNotes, { gfm: true, breaks: true });

    return template
        .replace("{{ releaseNotes }}", markdown)
        .replace(/\{\{\s*currentVersion\s*\}\}/g, currentVersion)
        .replace(/\{\{\s*newVersion\s*\}\}/g, latestVersion);
}
