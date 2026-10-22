import { createHash } from 'crypto';
import { App, TFile, parseLinktext } from 'obsidian';
import { LinkResolver } from './linkResolver';

/** One vault snapshot per export. File paths identify documents; IDs only navigate HTML. */
export class WikiExportContext {
    private readonly files = new Map<string, TFile>();
    private readonly pathToId = new Map<string, string>();
    private readonly idToPath = new Map<string, string>();
    private readonly targets = new Map<string, TFile | null>();

    constructor(private app: App, hash: (path: string) => string = path =>
        createHash('sha256').update(path, 'utf8').digest('hex')) {
        const resolver = new LinkResolver();
        const files = app.vault.getFiles().filter(file =>
            file.extension === 'md' || LinkResolver.isViewableFile(file));
        const candidates = new Map<string, string>();
        const counts = new Map<string, number>();
        for (const file of files) {
            this.files.set(file.path, file);
            const legacy = resolver.getFileSlug(file);
            candidates.set(file.path, legacy);
            counts.set(legacy, (counts.get(legacy) ?? 0) + 1);
        }
        // Reserve legacy names before allocating hashes, including possible hash-like filenames.
        const reserved = new Set(candidates.values());
        for (const path of [...this.files.keys()].sort()) {
            const legacy = candidates.get(path)!;
            let id = legacy;
            if (!legacy || /[^\x00-\x7f]/.test(path) || counts.get(legacy) !== 1) {
                const prefix = legacy.slice(0, 48) || 'page';
                const digest = hash(path);
                id = `${prefix}-${digest.slice(0, 32)}`;
                if (reserved.has(id) || this.idToPath.has(id)) id = `${prefix}-${digest}`;
                if (reserved.has(id) || this.idToPath.has(id)) {
                    // Injective fallback even if the hash function collides. Preserve UTF-16 code units.
                    const encoded = path.split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
                    id = `page-u${encoded}`;
                    while (reserved.has(id) || this.idToPath.has(id)) id += '-';
                }
            }
            this.pathToId.set(path, id);
            this.idToPath.set(id, path);
        }
    }

    pageId(path: string): string {
        const id = this.pathToId.get(path);
        if (!id) throw new Error(`File is not in the export snapshot: ${path}`);
        return id;
    }

    /** Let Obsidian resolve exact paths, relative links and duplicate basenames in source context. */
    resolve(rawTarget: string, sourcePath: string): TFile | null {
        const key = JSON.stringify([sourcePath, rawTarget]);
        if (this.targets.has(key)) return this.targets.get(key)!;
        const { path } = parseLinktext(rawTarget);
        const resolved = path
            ? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath)
            : this.files.get(sourcePath) ?? null;
        const file = resolved ? this.files.get(resolved.path) ?? null : null;
        this.targets.set(key, file);
        return file;
    }
}
