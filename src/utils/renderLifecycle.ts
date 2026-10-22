import { CancellationError, CancellationToken } from './cancellationToken';
import { PauseController } from './pauseController';

export class RenderTimeoutError extends Error {
    constructor() {
        super('Rendering exceeded 120 seconds of active time. Export stopped; no file was saved.');
        this.name = 'RenderTimeoutError';
    }
}

/** Bound asynchronous rendering, including plugins/images that never settle. Paused time is excluded. */
export function awaitRender<T>(work: Promise<T>, token: CancellationToken, pause: PauseController,
    timeoutMs = 120_000): Promise<T> {
    return new Promise((resolve, reject) => {
        let done = false;
        let elapsed = 0;
        let last = Date.now();
        let unsubscribe = () => {};
        const finish = (action: () => void): void => {
            if (done) return;
            done = true;
            clearInterval(timer);
            unsubscribe();
            action();
        };
        const timer = setInterval(() => {
            const now = Date.now();
            if (!pause.isPaused) elapsed += now - last;
            last = now;
            if (elapsed >= timeoutMs) finish(() => reject(new RenderTimeoutError()));
        }, Math.min(250, timeoutMs));
        unsubscribe = token.onCancel(() => finish(() => reject(new CancellationError())));
        work.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
}

/** Open before work starts and always close on task settlement, independent of UI counters. */
export async function runWithProgress<T>(
    modal: { openAndAwait(): Promise<boolean>; complete(): void },
    token: CancellationToken, pause: PauseController, work: () => Promise<T>,
): Promise<T> {
    const closed = modal.openAndAwait().then(completed => {
        if (!completed) { token.cancel(); pause.resume(); }
    });
    try {
        const result = await work();
        token.throwIfCancelled();
        return result;
    } finally {
        modal.complete();
        await closed;
    }
}
