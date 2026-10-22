// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from 'obsidian';
import { ExportWikiCommand } from './exportWiki';
import type AdvancedHtmlExportPlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings';
import { installObsidianDom, mockAppWithFiles } from '../utils/test-utils';
import * as fileUtils from '../utils/fileUtils';

const ui = vi.hoisted(() => ({ total: 0, open: false, closed: false, fail: false }));
vi.mock('../ui/modals/ExportPreviewModal', () => ({ ExportPreviewModal: class {
    async openAndAwait() { return { action: 'select' }; }
} }));
vi.mock('../ui/modals/NoteSelectionModal', () => ({ NoteSelectionModal: class {
    constructor(_app: unknown, private notes: Array<{ path: string }>) {}
    async openAndAwait() { return this.notes.filter(n => !n.path.endsWith('연구나.md')); }
} }));
vi.mock('../ui/modals/RenderingProgressModal', () => ({ RenderingProgressModal: class {
    private resolve!: (value: boolean) => void;
    constructor(_app: unknown, _token: unknown, _pause: unknown, metrics: { totalNotes: number }) { ui.total = metrics.totalNotes; }
    openAndAwait() { ui.open = true; return new Promise<boolean>(resolve => { this.resolve = resolve; }); }
    complete() { ui.closed = true; this.resolve(true); }
    handleEvent() {}
} }));

beforeEach(() => {
    vi.restoreAllMocks();
    installObsidianDom();
    document.body.innerHTML = '';
    Object.assign(ui, { total: 0, open: false, closed: false, fail: false });
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el, path) => {
        expect(ui.open).toBe(true);
        if (ui.fail && path.endsWith('연구가.md')) throw new Error('Fixture render failure');
        el.innerHTML = text;
    });
});

describe('Wiki export command integration', () => {
    it.each([false, true])('completes selected export and delivers metadata; SharePoint=%s', async sharePointMode => {
        const { app, byPath } = mockAppWithFiles({ 'Lab. Meeting.md': '[[연구가]] [[연구나]]',
            '연구가.md': '<h1>FIRST_BODY</h1>', '연구나.md': '<h1>SECOND_BODY</h1>' });
        const download = vi.spyOn(fileUtils, 'downloadBlob').mockImplementation(() => {});
        const settings = { ...DEFAULT_SETTINGS, sharePointMode, sharePointTitle: '표시 제목', sharePointFilename: '저장 이름' };
        await new ExportWikiCommand(app, { settings, manifest: { version: 'test' } } as AdvancedHtmlExportPlugin)
            .executeWithFile(byPath.get('Lab. Meeting.md')!);
        expect(ui).toMatchObject({ total: 2, open: true, closed: true });
        expect(download).toHaveBeenCalledOnce();
        const [blob, filename] = download.mock.calls[0];
        const html = await blob.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.querySelectorAll('.wiki-page')).toHaveLength(2);
        expect(doc.body.textContent).toContain('FIRST_BODY');
        expect(doc.body.textContent).not.toContain('SECOND_BODY');
        expect(doc.querySelector('[data-missing-target="연구나"]')).not.toBeNull();
        expect(doc.title).toBe(sharePointMode ? '표시 제목' : 'Lab. Meeting');
        expect(doc.documentElement.lang).toBe(sharePointMode ? 'ko' : 'en');
        expect(filename).toBe(sharePointMode ? '저장_이름.html' : 'Lab._Meeting-wiki.html');
    });
    it('finishes with an explicit error page if one Markdown renderer fails', async () => {
        const { app, byPath } = mockAppWithFiles({ 'root.md': '[[연구가]]', '연구가.md': 'BODY' });
        ui.fail = true;
        const download = vi.spyOn(fileUtils, 'downloadBlob').mockImplementation(() => {});
        await new ExportWikiCommand(app, { settings: DEFAULT_SETTINGS, manifest: { version: 'test' } } as AdvancedHtmlExportPlugin)
            .executeWithFile(byPath.get('root.md')!);
        expect(ui.closed).toBe(true);
        expect(download).toHaveBeenCalledOnce();
        expect(await download.mock.calls[0][0].text()).toContain('wiki-render-error');
    });
});
