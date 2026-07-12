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
  dialog,
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
import * as ext from './services/externalVaults';
import * as vaultFs from './services/vaultFs';

const isDev = !app.isPackaged;
const DEV_URL = process.env.BASALT_DEV_URL ?? 'http://localhost:5173';

// Test harnesses point this at a scratch dir so dev runs never touch (or
// depend on) the real profile. No-op in normal launches.
if (process.env.BASALT_USER_DATA) {
  app.setPath('userData', process.env.BASALT_USER_DATA);
}

/**
 * External "opened folder" vaults the user granted through the native picker.
 * Loaded once at startup; only the picker handler ever adds to it, so the
 * renderer can't name new absolute paths into existence. See externalVaults.ts
 * for the resolution rules.
 */
let externals: string[] = [];
const externalsFile = () => path.join(app.getPath('userData'), 'external-vaults.json');

/**
 * Absolute path of a vault's working tree. `dir` comes from the renderer on
 * every fs/git IPC call and is either a managed name under userData/vaults or
 * a registered external folder; anything else throws (a `..` escape would
 * otherwise let a compromised renderer read — or via deleteRepo's recursive
 * rm, delete — arbitrary directories).
 */
function vaultRoot(dir: string): string {
  const base = path.join(app.getPath('userData'), 'vaults');
  return ext.resolveVaultRoot(base, externals, dir).root;
}

function isExternalVault(dir: string): boolean {
  const base = path.join(app.getPath('userData'), 'vaults');
  return ext.resolveVaultRoot(base, externals, dir).external;
}

/**
 * Commit identity for external vaults: prefer the folder's own git config
 * (local or global user.name/email) over Basalt's built-in defaults, so
 * commits in a repo the user manages look like their CLI commits. Explicit
 * Basalt settings (non-default author) still win.
 */
async function effectiveAuthor(dir: string, author: Author): Promise<Author> {
  if (!isExternalVault(dir)) return author;
  const cfg = await engine.configAuthor(vaultRoot(dir));
  return {
    name: author.name === 'Basalt' && cfg.name ? cfg.name : author.name,
    email: author.email === 'basalt@localhost' && cfg.email ? cfg.email : author.email,
  };
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

  // basalt-file://<hex(vaultDir)>/<relpath> → a file in that vault's working
  // tree. The vault dir rides in the URL host, which browsers LOWERCASE — an
  // absolute external-folder path would be corrupted — so it's hex-encoded
  // (lowercase hex survives host normalization; fileUrl() below is the only
  // producer).
  protocol.handle('basalt-file', async (request) => {
    try {
      const url = new URL(request.url);
      if (!/^[0-9a-f]+$/.test(url.host)) return new Response('not found', { status: 404 });
      const dir = Buffer.from(url.host, 'hex').toString('utf8');
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
  return `basalt-file://${Buffer.from(dir, 'utf8').toString('hex')}/${segs}`;
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

function netCtx(event: IpcMainInvokeEvent, dir?: string): engine.NetCtx {
  return {
    auth: () => creds.getCredentials(credsFile()),
    onProgress: (p) => event.sender.send(CH.gitProgress, p),
    // Opened-folder vaults sync through the system git CLI so the user's own
    // credentials (ssh keys, credential helpers) apply; managed vaults keep
    // the stored-PAT flow.
    preferCli: dir !== undefined && isExternalVault(dir),
  };
}

/**
 * Native folder picker for "Open a folder as vault". The picked folder is
 * realpath'd and added to the external registry — the ONLY way a path outside
 * the managed sandbox becomes reachable over the bridge. Returns repo info so
 * the renderer can offer git syncing when the folder is already a clone.
 */
async function pickVaultFolder(): Promise<{
  dir: string;
  name: string;
  repo: Awaited<ReturnType<typeof engine.repoInfo>>;
} | null> {
  const win = BrowserWindow.getAllWindows()[0];
  const res = await dialog.showOpenDialog(win, {
    title: 'Open folder as vault',
    buttonLabel: 'Open vault',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const real = await fsp.realpath(res.filePaths[0]);
  const managedBase = path.join(app.getPath('userData'), 'vaults');
  if (real === managedBase || real.startsWith(managedBase + path.sep)) {
    throw new Error('That folder is already managed by Basalt.');
  }
  externals = ext.addExternal(externals, real);
  await ext.saveRegistry(externalsFile(), externals);
  return { dir: real, name: path.basename(real), repo: await engine.repoInfo(real) };
}

function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain);

  // Credentials (Keychain via safeStorage).
  h(CH.gitSetCredentials, (_e, opts: creds.Credentials) => creds.setCredentials(credsFile(), opts));
  h(CH.gitHasCredentials, () => creds.hasCredentials(credsFile()));
  h(CH.gitClearCredentials, () => creds.clearCredentials(credsFile()));

  // Vault folders.
  h(CH.vaultPickFolder, () => pickVaultFolder());

  // Git.
  h(CH.gitListRemoteBranches, (e, opts: { url: string }) =>
    engine.listRemoteBranches(opts.url, netCtx(e)),
  );
  h(CH.gitClone, (e, opts: { url: string; dir: string; branch: string }) =>
    engine.clone(vaultRoot(opts.dir), { url: opts.url, branch: opts.branch }, netCtx(e)),
  );
  h(CH.gitRepoInfo, (_e, opts: { dir: string }) => engine.repoInfo(vaultRoot(opts.dir)));
  h(CH.gitDeleteRepo, async (_e, opts: { dir: string }) => {
    // An external vault is the USER'S folder — never recursively delete it.
    // "Removing" it just revokes the grant; the managed clone case really rms.
    if (isExternalVault(opts.dir)) {
      externals = ext.removeExternal(externals, vaultRoot(opts.dir));
      await ext.saveRegistry(externalsFile(), externals);
      return;
    }
    return engine.deleteRepo(vaultRoot(opts.dir));
  });
  h(CH.gitStatus, async (_e, opts: { dir: string }) => ({
    dirty: await engine.status(vaultRoot(opts.dir)),
  }));
  h(CH.gitCommitAll, async (_e, opts: { dir: string; message: string; author: Author }) =>
    engine.commitAll(
      vaultRoot(opts.dir),
      opts.message,
      await effectiveAuthor(opts.dir, opts.author),
    ),
  );
  h(CH.gitFetch, (e, opts: { dir: string }) =>
    engine.fetch(vaultRoot(opts.dir), netCtx(e, opts.dir)),
  );
  h(CH.gitMerge, async (_e, opts: { dir: string; conflictSuffix: string; author: Author }) =>
    engine.merge(vaultRoot(opts.dir), {
      conflictSuffix: opts.conflictSuffix,
      author: await effectiveAuthor(opts.dir, opts.author),
    }),
  );
  h(CH.gitPush, (e, opts: { dir: string }) =>
    engine.push(vaultRoot(opts.dir), netCtx(e, opts.dir)),
  );
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

app.whenReady().then(async () => {
  externals = await ext.loadRegistry(externalsFile());
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
