// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, MarkdownRenderer } from 'obsidian';
import { runInNewContext } from 'vm';
import { WikiExportContext } from './wikiExportContext';
import { WikiExportOrchestrator, type WikiExportOptions } from './wikiExportOrchestrator';
import { DetailedWikiRenderer } from './detailedRenderer';
import { CancellationToken } from './cancellationToken';
import { PauseController } from './pauseController';
import { LinkResolver } from './linkResolver';
import { installObsidianDom, mockAppWithFiles } from './test-utils';

const options: WikiExportOptions = {
    imageQuality: 'high', enableLazyLoading: false, enableImageDeduplication: false,
    linkDepth: 3, includeUnlinked: false, enableInlineTOC: false,
};
beforeEach(() => {
    installObsidianDom();
    document.body.innerHTML = '';
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, el) => {
        el.innerHTML = markdown;
    });
});

describe('path identity and navigation IDs', () => {
    const paths = ['English/Note.md', 'English/연구가.md', 'English/연구나.md',
        '한글/연구.md', 'Other/Note.md', 'DAVIS 연구.md', 'Notes (v1).2.md',
        'a b.md', 'a-b.md', 'diagram.md', 'diagram.svg', '연구.md', '연구나.md',
        'é.md', 'e\u0301.md', 'A.md', 'a.md'];
    it('assigns nonempty unique CSS-safe IDs including extension and Unicode collisions', () => {
        const { app } = mockAppWithFiles(Object.fromEntries(paths.map(p => [p, ''])));
        const registry = new WikiExportContext(app);
        const ids = paths.map(p => registry.pageId(p));
        expect(new Set(ids).size).toBe(paths.length);
        expect(ids.every(id => /^[a-z0-9_-]+$/.test(id))).toBe(true);
        expect(registry.pageId('English/Note.md')).toBe('english-note');
    });
    it('is deterministic across file enumeration and detects forced hash collisions', () => {
        const first = new WikiExportContext(mockAppWithFiles(Object.fromEntries(paths.map(p => [p, '']))).app, () => '0'.repeat(64));
        const second = new WikiExportContext(mockAppWithFiles(Object.fromEntries([...paths].reverse().map(p => [p, '']))).app, () => '0'.repeat(64));
        expect(paths.map(p => first.pageId(p))).toEqual(paths.map(p => second.pageId(p)));
        expect(new Set(paths.map(p => first.pageId(p))).size).toBe(paths.length);
    });
    it('uses the host resolver with sourcePath and does not guess when it returns null', () => {
        const { app, byPath } = mockAppWithFiles({ 'A/Note.md': '', 'B/Note.md': '', 'B/Root.md': '' });
        const api = vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(byPath.get('B/Note.md')!);
        const context = new WikiExportContext(app);
        expect(context.resolve('Note#Section', 'B/Root.md')?.path).toBe('B/Note.md');
        expect(api).toHaveBeenCalledWith('Note', 'B/Root.md');
        api.mockReturnValue(null);
        expect(context.resolve('없는노트', 'B/Root.md')).toBeNull();
    });
});

async function exportFixture(folder: boolean, exclude = false, sharePointMode = false) {
    const prefix = folder ? '30. Research/' : '';
    const rootPath = prefix + (folder ? '38. Lab Meeting/' : '') + 'Meeting.md';
    const a = prefix + '연구가.md';
    const b = prefix + '연구나.md';
    const { app, byPath } = mockAppWithFiles({
        '42. Areas/Work/행정가.md': 'UNRELATED_BODY_ONLY',
        [rootPath]: '[[연구가|First]] [[연구나|Second]] [[없는노트]]',
        [a]: '<h1>BODY_A_ONLY</h1> [[연구나]]',
        [b]: '<h1>BODY_B_ONLY</h1> [[연구가]]',
    });
    const orch = new WikiExportOrchestrator(app, new Component(), options);
    const notes = await orch.collectNotes(byPath.get(rootPath)!);
    orch.setSelectedNotes(notes.filter(n => !exclude || n.path !== b));
    const renderer = new DetailedWikiRenderer(app, new Component(), { ...options, sharePointMode });
    const pages = await orch.renderNotesWithProgress(renderer, new CancellationToken(), new PauseController(), () => {});
    const html = renderer.generateWikiHtmlWithRenderedPages(byPath.get(rootPath)!, pages, orch.getSelectedNotes());
    return { html, notes, pages, a, b, rootPath, selected: orch.getSelectedNotes() };
}

describe('anonymized regression fixtures', () => {
    it.each([false, true])('keeps two Korean bodies distinct; folder=%s', async folder => {
        const { html, notes, pages, a, b, rootPath } = await exportFixture(folder);
        expect(notes.map(n => n.path).sort()).toEqual([rootPath, a, b].sort());
        expect(pages.get(a)).toContain('BODY_A_ONLY');
        expect(pages.get(a)).not.toContain('BODY_B_ONLY');
        expect(pages.get(b)).toContain('BODY_B_ONLY');
        expect(html).not.toContain('UNRELATED_BODY_ONLY');
        document.documentElement.innerHTML = html;
        const ids = [...document.querySelectorAll('.wiki-page')].map(el => el.id);
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        expect(ids).not.toContain('page-');
        for (const link of document.querySelectorAll('[data-page]')) {
            expect(ids).toContain('page-' + link.getAttribute('data-page'));
        }
    });
    it.each([false, true])('switches each Korean page using exported click handlers; SharePoint=%s', async mode => {
        const { html, notes, a, b } = await exportFixture(false, false, mode);
        document.documentElement.innerHTML = html;
        const script = document.querySelector('body script')!.textContent!;
        runInNewContext(script, { document, window, location: window.location, history: window.history,
            IntersectionObserver, setTimeout, clearTimeout, console });
        document.dispatchEvent(new Event('DOMContentLoaded'));
        for (const [path, body] of [[a, 'BODY_A_ONLY'], [b, 'BODY_B_ONLY']]) {
            const id = notes.find(n => n.path === path)!.slug;
            (document.querySelector(`a[data-page="${id}"]`) as HTMLElement).click();
            expect(document.querySelector('.wiki-page.active')?.id).toBe(`page-${id}`);
            expect(document.querySelector('.wiki-page.active')?.textContent).toContain(body);
        }
    });
    it('removes excluded navigation targets while keeping snapshot IDs stable', async () => {
        const full = await exportFixture(true);
        const partial = await exportFixture(true, true);
        expect(partial.selected.map(n => n.slug)).toEqual(full.notes.filter(n => n.path !== full.b).map(n => n.slug));
        expect(partial.pages.has(partial.b)).toBe(false);
        const root = partial.pages.get(partial.rootPath)!;
        expect(root).toContain('data-missing-target="연구나"');
        expect(root).not.toContain(`data-page="${full.notes.find(n => n.path === full.b)!.slug}"`);
    });
    it('excludes Properties/code examples and handles Unicode markdown destinations', async () => {
        const text = '---\nauthor: "[[저자]]"\n---\n`[[저자]]`\n```md\n[[저자]]\n```\n[[연구]] [Other](<한글/문서 (1).md>)';
        const resolver = new LinkResolver();
        expect(resolver.extractLinks(text).map(l => l.rawTarget)).toEqual(['연구', '<한글/문서 (1).md>']);
        resolver.setPageSlugResolver(() => ({ slug: 'ok', resolved: true }));
        const resolved = resolver.resolveLinks(text).content;
        expect(resolved).toContain('author: "[[저자]]"');
        expect(resolved).toContain('`[[저자]]`');
        expect(resolved.match(/data-page="ok"/g)).toHaveLength(2);
    });
});
