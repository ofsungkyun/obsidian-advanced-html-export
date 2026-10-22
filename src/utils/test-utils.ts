import { posix } from 'path';
import { TFile } from 'obsidian';

/**
 * Adds the Obsidian `HTMLElement.createDiv()` helper used by the renderers to
 * the DOM provided by the test environment (happy-dom / jsdom).
 */
export function installObsidianDom(): void {
  if (typeof HTMLElement === 'undefined') return;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.createDiv !== 'function') {
    proto.createDiv = function (this: HTMLElement, opts?: { cls?: string; text?: string }) {
      const el = this.ownerDocument.createElement('div');
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text !== undefined) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
}

/**
 * Installs a minimal `document` mock on `globalThis` for tests that only need
 * `document.body.createDiv()` to exist (renderers called outside a real DOM).
 */
export function installMockDocument(): void {
  const body = {
    createDiv: () => ({ innerHTML: '', querySelectorAll: () => [], setAttribute: () => {} }),
  };
  Object.defineProperty(globalThis, 'document', {
    value: { body, createElement: () => ({ innerHTML: '' }) },
    writable: true,
    configurable: true,
  });
}

export function createMockFile(path: string, content: string): TFile {
  const name = path.split('/').pop() || path;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';
  const basename = dot >= 0 ? name.slice(0, dot) : name;
  const file = new TFile();
  file.path = path;
  file.basename = basename;
  file.extension = ext;
  file.name = name;
  file.stat = { mtime: Date.now(), ctime: Date.now(), size: content.length };
  (file as unknown as Record<string, unknown>).__content = content;
  return file as unknown as TFile;
}

export function mockAppWithFiles(
  entries: Record<string, string>,
  frontmatterByPath?: Record<string, Record<string, unknown>>,
) {
  const files: TFile[] = [];
  const byPath = new Map<string, TFile>();

  for (const [p, c] of Object.entries(entries)) {
    const f = createMockFile(p, c);
    files.push(f);
    byPath.set(p, f);
  }

  const vault: Record<string, unknown> = {
    getFiles: () => files,
    cachedRead: async (f: TFile) =>
      (f as unknown as Record<string, unknown>).__content as string || '',
  };

  const metadataCache = {
    // Host stub; ambiguous resolution tests explicitly stub the API result.
    getFirstLinkpathDest: (target: string, sourcePath: string): TFile | null => {
      const relative = posix.normalize(posix.join(posix.dirname(sourcePath), target));
      for (const path of [relative, target]) {
        const file = byPath.get(path + '.md') ?? byPath.get(path);
        if (file) return file;
      }
      const matches = files.filter(f => f.name === target + '.md' || f.name === target || f.basename === target);
      return matches.length === 1 ? matches[0] : null;
    },
    getFileCache: (file: TFile) => {
      const fm = frontmatterByPath?.[file.path];
      return fm ? { frontmatter: fm } : null;
    },
  };

  const app = { vault, workspace: {}, metadataCache };
  return { app: app as unknown as import('obsidian').App, files, byPath };
}
