import { escapeHtml } from './htmlUtils';
import { isExternalLink, markdownLinkPattern, wikiLinkPattern } from './linkSyntax';

export interface LinkInfo {
    original: string;
    offset: number;
    target: string;
    rawTarget: string;
    alias: string;
    type: 'wiki' | 'markdown' | 'image-embed';
}

export interface PageSlugResolution {
    slug: string | null;
    resolved: boolean;
}

export class LinkResolver {
    private vaultFiles: Map<string, string> = new Map();
    private pageSlugResolver: ((rawTarget: string, sourcePath: string) => PageSlugResolution) | null = null;

    /** Extensions that can be displayed inline by Obsidian's MarkdownRenderer */
    static readonly VIEWABLE_EXTENSIONS = [
        'jpg', 'jpeg', 'png', 'bmp', 'gif', 'svg', 'webp', 'excalidraw',
    ];

    constructor(vaultFiles?: Map<string, string>) {
        if (vaultFiles) {
            this.vaultFiles = vaultFiles;
        }
    }

    setVaultFiles(files: Map<string, string>): void {
        this.vaultFiles = files;
    }

    setPageSlugResolver(resolver: (rawTarget: string, sourcePath: string) => PageSlugResolution): void {
        this.pageSlugResolver = resolver;
    }

    /** Check if a file is a known viewable type (image or excalidraw) */
    static isViewableFile(file: { extension: string; basename: string }): boolean {
        return LinkResolver.VIEWABLE_EXTENSIONS.includes(file.extension.toLowerCase())
            || (file.extension === 'md' && /\.excalidraw$/i.test(file.basename));
    }

    /** Get the embed link target for a viewable file (as used in ![[target]]) */
    static getEmbedTarget(file: { extension: string; name: string; basename: string }): string {
        if (file.extension === 'md' && /\.excalidraw$/i.test(file.basename)) {
            return file.basename;
        }
        return file.name;
    }

    /** Get the correct page slug for a file */
    getFileSlug(file: { path?: string; extension: string; basename: string }): string {
        let pathBase: string;

        if (file.path) {
            pathBase = file.path;

            if (file.extension === 'md' && /\.excalidraw$/i.test(file.basename)) {
                pathBase = pathBase.replace(/\.excalidraw\.md$/i, '');
            } else if (LinkResolver.isViewableFile(file)) {
                pathBase = pathBase.replace(new RegExp('\\.' + file.extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), '');
            } else {
                pathBase = pathBase.replace(/\.md$/i, '');
            }

            pathBase = pathBase.replace(/[/\\]+/g, '-');
        } else {
            pathBase = file.basename;
            if (LinkResolver.isViewableFile(file) && /\.excalidraw$/i.test(file.basename)) {
                pathBase = file.basename.replace(/\.excalidraw$/i, '');
            }
        }

        return this.slugify(pathBase);
    }

    slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/--+/g, '-')
            .replace(/^-+/, '')
            .replace(/-+$/, '');
    }

    extractLinks(content: string): LinkInfo[] {
        const links: LinkInfo[] = [];
        content = maskNonBodyLinks(content);

        // Match wiki links: both [[...]] and ![[...]]
        const wikiLinkRegex = wikiLinkPattern();
        let match;

        while ((match = wikiLinkRegex.exec(content)) !== null) {
            const fullMatch = match[0];
            const target = match[1].trim();
            const alias = match[2] ? match[2].trim() : target;
            
            // Check if this is an image embed (starts with ![[)
            const isImageEmbed = fullMatch.startsWith('![');

            links.push({
                original: fullMatch,
                offset: match.index,
                target: this.slugify(target),
                rawTarget: target,
                alias: alias,
                type: isImageEmbed ? 'image-embed' : 'wiki'
            });
        }

        const markdownLinkRegex = markdownLinkPattern();

        while ((match = markdownLinkRegex.exec(content)) !== null) {
            const fullMatch = match[0];
            const alias = match[1].trim();
            const href = match[2].trim();

            if (isExternalLink(href)) {
                continue;
            }

            const target = this.resolvePath(href, '');
            if (content[match.index - 1] !== '!') {
                links.push({
                    original: fullMatch,
                offset: match.index,
                    target: target,
                    rawTarget: href,
                    alias: alias,
                    type: 'markdown'
                });
            }
        }

        return links;
    }

    resolvePath(linkTarget: string, basePath: string): string {
        let resolvedPath = linkTarget;

        if (linkTarget.startsWith('./')) {
            resolvedPath = basePath + linkTarget.substring(1);
        } else if (linkTarget.startsWith('../')) {
            const baseParts = basePath.split('/');
            let prefix = '';
            let rest = linkTarget;

            while (rest.startsWith('../')) {
                baseParts.pop();
                rest = rest.substring(3);
            }

            if (baseParts.length > 0) {
                prefix = baseParts.join('/') + '/';
            }

            resolvedPath = prefix + rest;
        }

        resolvedPath = resolvedPath.replace(/\.md$/i, '');

        const slug = this.slugify(resolvedPath.split('/').pop() || resolvedPath);

        return slug;
    }

    resolveLinks(content: string, sourcePath = ''): { content: string; links: LinkInfo[] } {
        const links = this.extractLinks(content);
        let resolvedContent = content;
        for (const link of [...links].sort((a, b) => b.offset - a.offset)) {
            if (link.type === 'image-embed') continue;
            let target = link.rawTarget;
            if (link.type === 'markdown') {
                try { target = decodeURIComponent(target.replace(/^<|>$/g, '')); } catch { /* Keep malformed escapes literal. */ }
            }
            const resolution = this.pageSlugResolver?.(target, sourcePath);
            const slug = resolution ? (resolution.resolved ? resolution.slug : null) : link.target;
            const replacement = slug
                ? `<a href="javascript:void(0)" data-page="${escapeHtml(slug)}">${escapeHtml(link.alias)}</a>`
                : `<span class="wiki-link-missing" data-missing-target="${escapeHtml(target)}">${escapeHtml(link.alias)}</span>`;
            resolvedContent = resolvedContent.slice(0, link.offset) + replacement + resolvedContent.slice(link.offset + link.original.length);
        }
        return { content: resolvedContent, links };
    }

    findFileByLink(linkTarget: string, basePath: string = ''): string | null {
        // Compatibility utility without an App. Never compare lossy slugs.
        const target = linkTarget.replace(/\.md$/i, '');
        const paths = [...this.vaultFiles.values()];
        const direct = paths.find(path => path.replace(/\.md$/i, '') === target ||
            path.replace(/\.md$/i, '') === `${basePath}/${target}`);
        if (direct) return direct;
        const matches = paths.filter(path => path.split('/').pop()?.replace(/\.md$/i, '') === target);
        return matches.length === 1 ? matches[0] : null;
    }
}

/** Mask non-body text without changing offsets. Cached Obsidian links remain authoritative. */
export function maskNonBodyLinks(content: string): string {
    const mask = (text: string): string => text.replace(/[^\r\n]/g, ' ');
    return content
        .replace(/^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, mask)
        .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*(?:\n|$)/gm, mask)
        .replace(/(`+)([\s\S]*?)\1/g, mask)
        .replace(/<!--[\s\S]*?-->/g, mask);
}
