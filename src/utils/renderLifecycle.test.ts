import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { awaitRender, RenderTimeoutError, runWithProgress } from './renderLifecycle';
import { CancellationError, CancellationToken } from './cancellationToken';
import { PauseController } from './pauseController';
import { WikiExportOrchestrator } from './wikiExportOrchestrator';
import { DetailedWikiRenderer, type RenderEvent } from './detailedRenderer';
import { mockAppWithFiles } from './test-utils';

afterEach(() => vi.useRealTimers());
describe('bounded rendering', () => {
    it('rejects never-settling work and excludes paused time', async () => {
        vi.useFakeTimers();
        const pause = new PauseController();
        pause.pause();
        const result = awaitRender(new Promise(() => {}), new CancellationToken(), pause, 500);
        const assertion = expect(result).rejects.toBeInstanceOf(RenderTimeoutError);
        await vi.advanceTimersByTimeAsync(5000);
        pause.resume();
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
    });
    it('rejects promptly on cancellation even when work never returns', async () => {
        const token = new CancellationToken();
        const result = awaitRender(new Promise(() => {}), token, new PauseController());
        token.cancel();
        await expect(result).rejects.toBeInstanceOf(CancellationError);
    });
    it('opens before rendering and closes on rejection without waiting for UI counters', async () => {
        let close!: (value: boolean) => void;
        const modal = { openAndAwait: vi.fn(() => new Promise<boolean>(resolve => { close = resolve; })),
            complete: vi.fn(() => close(true)) };
        const result = runWithProgress(modal, new CancellationToken(), new PauseController(), async () => {
            expect(modal.openAndAwait).toHaveBeenCalledOnce();
            throw new Error('render failed');
        });
        await expect(result).rejects.toThrow('render failed');
        expect(modal.complete).toHaveBeenCalledOnce();
    });
});

async function setup() {
    const { app, byPath } = mockAppWithFiles({ 'root.md': '[[A]] [[B]]', 'A.md': 'A', 'B.md': 'B' });
    const options = { imageQuality: 'high' as const, enableLazyLoading: false, enableImageDeduplication: false,
        linkDepth: 1, includeUnlinked: false };
    const orch = new WikiExportOrchestrator(app, new Component(), options);
    const notes = await orch.collectNotes(byPath.get('root.md')!);
    const renderer = new DetailedWikiRenderer(app, new Component(), options);
    return { orch, notes, renderer };
}
describe('selected-note accounting', () => {
    it('uses selected metrics, deduplicates paths, continues failures with explicit error pages', async () => {
        const { orch, notes, renderer } = await setup();
        const collectedMetrics = orch.getMetrics();
        orch.setSelectedNotes([notes[0], notes[1], notes[1]]);
        expect(collectedMetrics?.totalNotes).toBe(3);
        expect(orch.getMetrics()?.totalNotes).toBe(2);
        vi.spyOn(renderer, 'renderPageWithProgress').mockResolvedValueOnce('ROOT').mockRejectedValueOnce(new Error('bad <image>'));
        const events: RenderEvent[] = [];
        const pages = await orch.renderNotesWithProgress(renderer, new CancellationToken(), new PauseController(), e => events.push(e));
        expect(pages.size).toBe(2);
        expect(pages.get('A.md')).toContain('bad &lt;image&gt;');
        expect(orch.getRenderSummary()).toMatchObject({ completed: 1, failed: 1, selected: 2 });
        expect(orch.getStage()).toBe('completed_with_errors');
        expect(events.filter(e => e.details?.terminal)).toHaveLength(1);
    });
    it('records zero selected notes instead of falling back to all notes', async () => {
        const { orch } = await setup();
        orch.setSelectedNotes([]);
        expect(orch.getMetrics()?.totalNotes).toBe(0);
    });
    it('settles cancellation while waiting on pause', async () => {
        const { orch, notes, renderer } = await setup();
        orch.setSelectedNotes(notes);
        const token = new CancellationToken();
        const pause = new PauseController();
        pause.pause();
        const result = orch.renderNotesWithProgress(renderer, token, pause, () => {});
        token.cancel();
        await expect(result).rejects.toBeInstanceOf(CancellationError);
        expect(orch.getStage()).toBe('cancelled');
        expect(orch.getRenderSummary()).toMatchObject({ completed: 0, failed: 0 });
    });
});
