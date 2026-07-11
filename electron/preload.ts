/**
 * Preload: the only thing exposed to the renderer's main world. It publishes a
 * typed `window.basalt` whose every method is an ipcRenderer.invoke to a main
 * handler — no Node, no fs, no ipcRenderer leak into the page. contextIsolation
 * keeps this bridge tamper-proof from page scripts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { BasaltBridge } from '../src/engine/bridge';
import type { GitProgress } from '../src/engine/types';
import { CH } from './ipc';

const api: BasaltBridge = {
  platform: 'electron',
  git: {
    setCredentials: (opts) => ipcRenderer.invoke(CH.gitSetCredentials, opts),
    hasCredentials: () => ipcRenderer.invoke(CH.gitHasCredentials),
    clearCredentials: () => ipcRenderer.invoke(CH.gitClearCredentials),
    listRemoteBranches: (opts) => ipcRenderer.invoke(CH.gitListRemoteBranches, opts),
    clone: (opts) => ipcRenderer.invoke(CH.gitClone, opts),
    repoInfo: (opts) => ipcRenderer.invoke(CH.gitRepoInfo, opts),
    deleteRepo: (opts) => ipcRenderer.invoke(CH.gitDeleteRepo, opts),
    status: (opts) => ipcRenderer.invoke(CH.gitStatus, opts),
    commitAll: (opts) => ipcRenderer.invoke(CH.gitCommitAll, opts),
    fetch: (opts) => ipcRenderer.invoke(CH.gitFetch, opts),
    merge: (opts) => ipcRenderer.invoke(CH.gitMerge, opts),
    push: (opts) => ipcRenderer.invoke(CH.gitPush, opts),
    log: (opts) => ipcRenderer.invoke(CH.gitLog, opts),
    fileAtCommit: (opts) => ipcRenderer.invoke(CH.gitFileAtCommit, opts),
    onProgress: (cb: (p: GitProgress) => void) => {
      const listener = (_e: IpcRendererEvent, p: GitProgress) => cb(p);
      ipcRenderer.on(CH.gitProgress, listener);
      return () => ipcRenderer.removeListener(CH.gitProgress, listener);
    },
  },
  fs: {
    list: (dir) => ipcRenderer.invoke(CH.fsList, dir),
    read: (dir, path) => ipcRenderer.invoke(CH.fsRead, dir, path),
    readMany: (dir, paths) => ipcRenderer.invoke(CH.fsReadMany, dir, paths),
    write: (dir, path, text) => ipcRenderer.invoke(CH.fsWrite, dir, path, text),
    writeBinary: (dir, path, base64) => ipcRenderer.invoke(CH.fsWriteBinary, dir, path, base64),
    remove: (dir, path) => ipcRenderer.invoke(CH.fsRemove, dir, path),
    rename: (dir, from, to) => ipcRenderer.invoke(CH.fsRename, dir, from, to),
    mkdir: (dir, path) => ipcRenderer.invoke(CH.fsMkdir, dir, path),
    rmdir: (dir, path) => ipcRenderer.invoke(CH.fsRmdir, dir, path),
    fileUrl: (dir, path) => ipcRenderer.invoke(CH.fsFileUrl, dir, path),
  },
  openExternal: (dir, path) => ipcRenderer.invoke(CH.openExternal, dir, path),
};

contextBridge.exposeInMainWorld('basalt', api);

// Let the CSS reserve the traffic-light gutter and enable the drag region.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-electron');
});
