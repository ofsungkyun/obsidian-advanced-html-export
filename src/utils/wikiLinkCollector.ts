import { WikiExportContext } from './wikiExportContext';
import { App, TFile } from 'obsidian';
import { LinkResolver } from './linkResolver';

export interface CollectedFile {
    file: TFile;
    depth: number;
}

export class WikiLinkCollector {
    private app: App;
    private linkResolver: LinkResolver;
    readonly context: WikiExportContext;
    constructor(app: App, linkResolver: LinkResolver, context = new WikiExportContext(app)) {
        this.app = app;
        this.linkResolver = linkResolver;
        this.context = context;
        this.linkResolver.setPageSlugResolver((target, sourcePath) => {
            const file = this.findFileByLink(target, sourcePath);
            return file ? { slug: context.pageId(file.path), resolved: true } : { slug: null, resolved: false };
        });
    }
    findFileByLink(linkTarget: string, sourcePath = ''): TFile | null {
        return this.context.resolve(linkTarget, sourcePath);
    }

    async collectLinkedFiles(root: TFile, maxDepth: number, shouldIncludeFile?: (file: TFile) => boolean): Promise<CollectedFile[]> {
        const visited = new Set<string>();
        const queue: Array<{ file: TFile; depth: number }> = [{ file: root, depth: 0 }];
        const result: CollectedFile[] = [];

        while (queue.length > 0) {
            const { file, depth } = queue.shift()!;

            if (visited.has(file.path)) continue;
            visited.add(file.path);

            // Exclude check: stop traversal for excluded files
            if (shouldIncludeFile && !shouldIncludeFile(file)) {
                continue;
            }

            result.push({ file, depth });

            if (depth >= maxDepth) continue;

            const content = await this.app.vault.cachedRead(file);
            // Cached body links exclude Properties and code examples.
            const cachedLinks = this.app.metadataCache.getFileCache(file)?.links;
            const links = cachedLinks
                ? cachedLinks.map(link => ({ rawTarget: link.link, type: 'wiki' }))
                : this.linkResolver.extractLinks(content);

            for (const link of links) {
                if (link.type === 'image-embed') continue;

                let target = link.rawTarget;
                if (link.type === 'markdown') {
                    try { target = decodeURIComponent(target.replace(/^<|>$/g, '')); } catch { /* Keep literal. */ }
                }
                const targetFile = this.findFileByLink(target, file.path);
                if (targetFile && !visited.has(targetFile.path)) {
                    queue.push({ file: targetFile, depth: depth + 1 });
                }
            }
        }

        return result;
    }
}
