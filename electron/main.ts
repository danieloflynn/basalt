/**
 * Electron main process — Basalt for Mac. Owns the window, two custom protocols
 * (app:// serves the built renderer; basalt-file:// streams vault attachments),
 * and every privileged IPC handler that backs the renderer's GitEngine / VaultFS
 * / credential store. The renderer has no Node or filesystem access; it reaches
 * all of this only through the preload's window.basalt bridge.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type { Author } from '../src/engine/types';
import { CH } from './ipc';
import * as engine from './git/engine';
import * as creds from './services/creds';
import * as vaultFs from './services/vaultFs';

const isDev = !app.isPackaged;
const DEV_URL = process.env.BASALT_DEV_URL ?? 'http://localhost:5173';

/**
 * Absolute path of a vault's git working tree, under the app's data dir. `dir`
 * comes from the renderer on every fs/git IPC call; a `..` in it would otherwise
 * escape the vaults sandbox and, via deleteRepo's recursive rm, let a compromised
 * renderer delete arbitrary directories. Resolve and assert containment.
 */
function vaultRoot(dir: string): string {
  const base = path.join(app.getPath('userData'), 'vaults');
  const abs = path.resolve(base, dir);
  // Must be a strict child of base: rejects `..` escapes AND an empty/"." dir
  // that would resolve to the vaults root itself (deleteRepo there wipes all).
  if (!abs.startsWith(base + path.sep)) {
    throw new Error(`Invalid vault directory: ${dir}`);
  }
  return abs;
}

const credsFile = () => path.join(app.getPath('userData'), 'credentials.json');

/** Custom schemes must be declared privileged before the app is ready. */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'basalt-file', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerProtocols(): void {
  // app://bundle/... → the built renderer in dist/ (absolute /assets paths work).
  const distDir = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const abs = path.join(distDir, rel);
    // Never serve outside dist; fall back to the SPA entry.
    const target = abs.startsWith(distDir + path.sep) ? abs : path.join(distDir, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });

  // basalt-file://<vaultDir>/<relpath> → a file in that vault's working tree.
  protocol.handle('basalt-file', async (request) => {
    try {
      const url = new URL(request.url);
      const dir = decodeURIComponent(url.host);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const root = await fsp.realpath(vaultRoot(dir));
      const abs = path.resolve(root, rel);
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      // Resolve symlinks and re-check containment: a vault file that links
      // outside the vault must not stream out-of-vault content to the webview.
      const real = await fsp.realpath(abs);
      if (real !== root && !real.startsWith(root + path.sep)) {
        return new Response('forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(real).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/** Our own renderer origins: the app:// bundle or the dev server (any path). */
function isInternalUrl(url: string): boolean {
  if (url.startsWith('app://')) return true;
  try {
    return new URL(url).origin === new URL(DEV_URL).origin;
  } catch {
    return false;
  }
}

function fileUrl(dir: string, rel: string): string {
  const segs = rel.split('/').map(encodeURIComponent).join('/');
  return `basalt-file://${encodeURIComponent(dir)}/${segs}`;
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#131215', // basalt bg, so no white flash before paint
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // http(s) links (external anchors, Capacitor Browser.open) go to the system
  // browser; the app itself never spawns extra windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Lock top-level navigation to our own origin. The preload (and thus the
  // privileged window.basalt bridge) runs on every document this webContents
  // loads, so a stray link, location.href, or XSS navigating to a remote page
  // would otherwise hand that origin full fs/git/creds access. Keep it in-app;
  // send anything external to the system browser instead.
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  if (isDev) void win.loadURL(DEV_URL);
  else void win.loadURL('app://bundle/index.html');
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function netCtx(event: IpcMainInvokeEvent): engine.NetCtx {
  return {
    auth: () => creds.getCredentials(credsFile()),
    onProgress: (p) => event.sender.send(CH.gitProgress, p),
  };
}

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain);

  // Credentials (Keychain via safeStorage).
  h(CH.gitSetCredentials, (_e, opts: creds.Credentials) => creds.setCredentials(credsFile(), opts));
  h(CH.gitHasCredentials, () => creds.hasCredentials(credsFile()));
  h(CH.gitClearCredentials, () => creds.clearCredentials(credsFile()));

  // Git.
  h(CH.gitListRemoteBranches, (e, opts: { url: string }) =>
    engine.listRemoteBranches(opts.url, netCtx(e)),
  );
  h(CH.gitClone, (e, opts: { url: string; dir: string; branch: string }) =>
    engine.clone(vaultRoot(opts.dir), { url: opts.url, branch: opts.branch }, netCtx(e)),
  );
  h(CH.gitRepoInfo, (_e, opts: { dir: string }) => engine.repoInfo(vaultRoot(opts.dir)));
  h(CH.gitDeleteRepo, (_e, opts: { dir: string }) => engine.deleteRepo(vaultRoot(opts.dir)));
  h(CH.gitStatus, async (_e, opts: { dir: string }) => ({
    dirty: await engine.status(vaultRoot(opts.dir)),
  }));
  h(CH.gitCommitAll, (_e, opts: { dir: string; message: string; author: Author }) =>
    engine.commitAll(vaultRoot(opts.dir), opts.message, opts.author),
  );
  h(CH.gitFetch, (e, opts: { dir: string }) => engine.fetch(vaultRoot(opts.dir), netCtx(e)));
  h(CH.gitMerge, (_e, opts: { dir: string; conflictSuffix: string; author: Author }) =>
    engine.merge(vaultRoot(opts.dir), { conflictSuffix: opts.conflictSuffix, author: opts.author }),
  );
  h(CH.gitPush, (e, opts: { dir: string }) => engine.push(vaultRoot(opts.dir), netCtx(e)));
  h(CH.gitLog, (_e, opts: { dir: string; limit?: number; path?: string }) =>
    engine.log(vaultRoot(opts.dir), { limit: opts.limit, path: opts.path }),
  );
  h(CH.gitFileAtCommit, (_e, opts: { dir: string; oid: string; path: string }) =>
    engine.fileAtCommit(vaultRoot(opts.dir), opts.oid, opts.path),
  );

  // Vault filesystem.
  h(CH.fsList, (_e, dir: string) => vaultFs.list(vaultRoot(dir)));
  h(CH.fsRead, (_e, dir: string, p: string) => vaultFs.read(vaultRoot(dir), p));
  h(CH.fsReadMany, (_e, dir: string, ps: string[]) => vaultFs.readMany(vaultRoot(dir), ps));
  h(CH.fsWrite, (_e, dir: string, p: string, text: string) =>
    vaultFs.write(vaultRoot(dir), p, text),
  );
  h(CH.fsWriteBinary, (_e, dir: string, p: string, b64: string) =>
    vaultFs.writeBinary(vaultRoot(dir), p, b64),
  );
  h(CH.fsRemove, (_e, dir: string, p: string) => vaultFs.remove(vaultRoot(dir), p));
  h(CH.fsRename, (_e, dir: string, from: string, to: string) =>
    vaultFs.rename(vaultRoot(dir), from, to),
  );
  h(CH.fsMkdir, (_e, dir: string, p: string) => vaultFs.mkdir(vaultRoot(dir), p));
  h(CH.fsRmdir, (_e, dir: string, p: string) => vaultFs.rmdir(vaultRoot(dir), p));
  h(CH.fsFileUrl, (_e, dir: string, p: string) => fileUrl(dir, p));

  h(CH.openExternal, (_e, dir: string, p: string) => {
    const root = vaultRoot(dir);
    const abs = path.resolve(root, p);
    if (abs !== root && !abs.startsWith(root + path.sep)) return;
    return shell.openPath(abs);
  });
}

app.whenReady().then(() => {
  registerProtocols();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
