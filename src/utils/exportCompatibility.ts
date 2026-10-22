import { escapeHtml } from './htmlUtils';
import { generateSafeFilename, sanitizeFilename } from './fileUtils';

export interface SharePointOptions {
    sharePointMode?: boolean;
    sharePointRemoveExportedSuffix?: boolean;
    sharePointNumericTitle?: boolean;
    sharePointUtf8Bom?: boolean;
    sharePointLanguage?: string;
    sharePointTitle?: string;
    sharePointFilename?: string;
}

/** Metadata is applied at template construction, never by rewriting body HTML or scripts. */
export function exportDocumentMetadata(defaultTitle: string, options: SharePointOptions = {}): {
    title: string; titleHtml: string; language: string;
} {
    let title = defaultTitle;
    let language = 'en';
    if (options.sharePointMode) {
        title = options.sharePointTitle?.trim() || title;
        if (options.sharePointRemoveExportedSuffix !== false) title = title.replace(/ - Exported$/, '');
        const requested = options.sharePointLanguage?.trim() ?? 'ko';
        if (/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(requested)) language = requested;
    }
    let titleHtml = escapeHtml(title);
    if (options.sharePointMode && options.sharePointNumericTitle !== false) {
        titleHtml = titleHtml.replace(/[^\x00-\x7f]/gu, character => `&#${character.codePointAt(0)};`);
    }
    return { title, titleHtml, language };
}

/** Add exactly one BOM to the final download, after optional compression. */
export function addExportBom(html: string, options: SharePointOptions = {}): string {
    return options.sharePointMode && options.sharePointUtf8Bom !== false
        ? '\uFEFF' + html.replace(/^\uFEFF+/, '') : html;
}

export function exportFilename(path: string, wiki: boolean, options: SharePointOptions = {}): string {
    const custom = options.sharePointMode ? options.sharePointFilename?.trim() : '';
    if (custom) {
        const name = sanitizeFilename(custom.replace(/\.html?$/i, '')).replace(/[. ]+$/, '');
        return `${name || 'export'}.html`;
    }
    const name = generateSafeFilename(path);
    return wiki ? name.replace(/\.html$/, '-wiki.html') : name;
}
