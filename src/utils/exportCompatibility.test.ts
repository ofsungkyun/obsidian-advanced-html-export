// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings';
import { addExportBom, exportDocumentMetadata, exportFilename } from './exportCompatibility';
import { wrapHtmlForExportWithMeta } from './selfExtract';
import WikiHtmlRenderer from './wikiHtmlRenderer';
import HtmlRenderer from './htmlRenderer';
import { ExportSingleFileCommand } from '../commands/exportSingleFile';
import type AdvancedHtmlExportPlugin from '../main';
import * as fileUtils from './fileUtils';
import { mockAppWithFiles } from './test-utils';

const enabled = { ...DEFAULT_SETTINGS, sharePointMode: true };
beforeEach(() => { document.documentElement.innerHTML = ''; vi.restoreAllMocks(); });

describe('SharePoint document metadata', () => {
    it('defaults OFF and ignores dormant compatibility overrides', () => {
        expect(DEFAULT_SETTINGS.sharePointMode).toBe(false);
        const options = { ...DEFAULT_SETTINGS, sharePointTitle: 'Override', sharePointFilename: 'Override' };
        expect(exportDocumentMetadata('한글 - Exported', options)).toEqual({
            title: '한글 - Exported', titleHtml: '한글 - Exported', language: 'en',
        });
        expect(addExportBom('<html>', options)).toBe('<html>');
        expect(exportFilename('file.md', false, options)).toBe('file.html');
    });
    it('encodes Unicode code points including emoji and decodes to the same title', () => {
        const result = exportDocumentMetadata('연구 & 😀 <test> - Exported', enabled);
        expect(result.titleHtml).toContain('&#128512;');
        expect(result.titleHtml).not.toMatch(/[^\x00-\x7f]/);
        document.head.innerHTML = `<title>${result.titleHtml}</title>`;
        expect(document.title).toBe('연구 & 😀 <test>');
    });
    it('controls each option separately and removes only a trailing suffix', () => {
        expect(exportDocumentMetadata('A - Exported B', enabled).title).toBe('A - Exported B');
        const result = exportDocumentMetadata('연구 - Exported', { ...enabled,
            sharePointNumericTitle: false, sharePointRemoveExportedSuffix: false, sharePointLanguage: 'en-US' });
        expect(result).toEqual({ title: '연구 - Exported', titleHtml: '연구 - Exported', language: 'en-US' });
        expect(addExportBom('text', { ...enabled, sharePointUtf8Bom: false })).toBe('text');
        expect(exportDocumentMetadata('T', { ...enabled, sharePointLanguage: 'ko" onload="bad' }).language).toBe('en');
        expect(exportDocumentMetadata('T', { ...enabled, sharePointLanguage: '' }).language).toBe('en');
    });
    it('adds precisely one UTF-8 BOM and accounts for its three bytes', () => {
        const html = '<!DOCTYPE html><html lang="ko"><title>T</title></html>';
        const result = wrapHtmlForExportWithMeta(html, 'none', 'T', enabled);
        expect([...Buffer.from(result.html).subarray(0, 3)]).toEqual([239, 187, 191]);
        expect(result.meta.outputBytes).toBe(Buffer.byteLength(html) + 3);
        expect(addExportBom(result.html, enabled)).toBe(result.html);
    });
    it('keeps title and download filename independent and preserves dots and Korean', () => {
        const options = { ...enabled, sharePointTitle: '표시 제목', sharePointFilename: '저장 파일.2026.html' };
        expect(exportDocumentMetadata('original', options).title).toBe('표시 제목');
        expect(exportFilename('original.md', true, options)).toBe('저장_파일.2026.html');
        expect(exportFilename('Notes/Lab. Meeting.md', true)).toBe('Lab._Meeting-wiki.html');
        expect(exportFilename('한글.md', false)).toBe('한글.html');
    });
});

describe('template and download integration', () => {
    it('changes only wiki head metadata, preserving body, scripts, CSS, images and page IDs', () => {
        const { app, byPath } = mockAppWithFiles({ 'Meeting.md': '' });
        const page = { path: 'Meeting.md', slug: 'meeting', title: '연구 "제목"' };
        const body = '<p>한국어 BODY</p><img src="data:image/png;base64,AAAA">';
        const render = (sharePointMode: boolean) => new WikiHtmlRenderer(app, new Component(), {
            ...DEFAULT_SETTINGS, wikiTitle: '연구 - Exported', sharePointMode,
        }).generateWikiHtmlWithRenderedPages(byPath.get(page.path)!, new Map([[page.path, body]]), [page]);
        const normal = new DOMParser().parseFromString(render(false), 'text/html');
        const compat = new DOMParser().parseFromString(render(true), 'text/html');
        expect(compat.documentElement.lang).toBe('ko');
        expect(compat.title).toBe('연구');
        expect(normal.title).toBe('연구 - Exported');
        expect(compat.body.innerHTML).toBe(normal.body.innerHTML);
        expect(compat.querySelector('style')?.textContent).toBe(normal.querySelector('style')?.textContent);
        expect(compat.querySelector('.wiki-page')?.innerHTML).toBe(body);
    });
    it.each([false, true])('single-file command downloads correct metadata; enabled=%s', async mode => {
        const { app, byPath } = mockAppWithFiles({ '한글.노트.md': 'SOURCE' });
        app.workspace.getActiveFile = () => byPath.get('한글.노트.md')!;
        vi.spyOn(HtmlRenderer.prototype, 'render').mockResolvedValue('<p>BODY</p><script>const a = "한글";</script>');
        const download = vi.spyOn(fileUtils, 'downloadBlob').mockImplementation(() => {});
        const settings = { ...DEFAULT_SETTINGS, sharePointMode: mode, sharePointTitle: '표시 제목', sharePointFilename: '저장 이름' };
        await new ExportSingleFileCommand(app, { settings } as AdvancedHtmlExportPlugin).execute();
        expect(download).toHaveBeenCalledOnce();
        const [blob, filename] = download.mock.calls[0];
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect([...bytes.subarray(0, 3)]).toEqual(mode ? [239, 187, 191] : [60, 33, 68]);
        const html = await blob.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.title).toBe(mode ? '표시 제목' : '한글.노트 - Exported');
        expect(doc.documentElement.lang).toBe(mode ? 'ko' : 'en');
        expect(filename).toBe(mode ? '저장_이름.html' : '한글.노트.html');
        expect(doc.body.innerHTML).toContain('const a = "한글";');
    });
});
