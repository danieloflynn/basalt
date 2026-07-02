package com.danielpoflynn.basalt;

import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.MergeResult;
import org.eclipse.jgit.api.Status;
import org.eclipse.jgit.api.errors.TransportException;
import org.eclipse.jgit.dircache.DirCache;
import org.eclipse.jgit.dircache.DirCacheEntry;
import org.eclipse.jgit.lib.BranchTrackingStatus;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectLoader;
import org.eclipse.jgit.lib.PersonIdent;
import org.eclipse.jgit.lib.ProgressMonitor;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.revwalk.RevCommit;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * All git operations for Basalt, backed by JGit. Runs on a single-threaded
 * executor so operations are serialized (a git repo must never see two
 * concurrent mutations) and never block the UI or the bridge.
 *
 * The GitHub PAT lives in EncryptedSharedPreferences (Android Keystore) and
 * never crosses back into JavaScript.
 */
@CapacitorPlugin(name = "BasaltGit")
public class BasaltGitPlugin extends Plugin {

    private static final String PREFS_FILE = "basalt_git_credentials";
    private static final long MAX_TEXT_FILE_BYTES = 5L * 1024 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private interface Work {
        JSObject run() throws Exception;
    }

    private void run(PluginCall call, Work work) {
        executor.execute(() -> {
            try {
                call.resolve(work.run());
            } catch (Exception e) {
                call.reject(friendlyMessage(e), e.getClass().getSimpleName(), e);
            }
        });
    }

    /** Map raw git/network errors to messages a human can act on (ST-5). */
    private static String friendlyMessage(Exception e) {
        Throwable t = e;
        while (t != null) {
            if (t instanceof UnknownHostException) {
                return "Can't reach GitHub — you appear to be offline.";
            }
            String m = t.getMessage() == null ? "" : t.getMessage().toLowerCase(Locale.ROOT);
            if (m.contains("not authorized") || m.contains("authentication") || m.contains("401")) {
                return "GitHub rejected the credentials. Check that the token is valid and has access to this repository.";
            }
            if (m.contains("not found") || m.contains("404")) {
                return "Repository not found. Check the URL — and for private repos, that the token can read it.";
            }
            t = t.getCause();
        }
        return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
    }

    private File repoDir(PluginCall call) {
        String dir = call.getString("dir", "vault");
        return new File(getContext().getFilesDir(), dir);
    }

    // ------------------------------------------------------------------
    // Credentials (Android Keystore via EncryptedSharedPreferences)
    // ------------------------------------------------------------------

    private SharedPreferences securePrefs() throws Exception {
        MasterKey key = new MasterKey.Builder(getContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
        return EncryptedSharedPreferences.create(
                getContext(),
                PREFS_FILE,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    }

    private CredentialsProvider credentials() throws Exception {
        SharedPreferences prefs = securePrefs();
        String token = prefs.getString("token", null);
        if (token == null) throw new IllegalStateException("No git credentials stored yet.");
        String username = prefs.getString("username", "");
        if (username == null || username.isEmpty()) username = "x-access-token";
        return new UsernamePasswordCredentialsProvider(username, token);
    }

    @PluginMethod
    public void setCredentials(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("A token is required.");
            return;
        }
        String username = call.getString("username", "");
        run(call, () -> {
            securePrefs().edit().putString("token", token).putString("username", username).apply();
            return new JSObject();
        });
    }

    @PluginMethod
    public void hasCredentials(PluginCall call) {
        run(call, () -> {
            JSObject out = new JSObject();
            out.put("value", securePrefs().getString("token", null) != null);
            return out;
        });
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        run(call, () -> {
            securePrefs().edit().clear().apply();
            return new JSObject();
        });
    }

    // ------------------------------------------------------------------
    // Remote inspection / clone
    // ------------------------------------------------------------------

    @PluginMethod
    public void listRemoteBranches(PluginCall call) {
        String url = call.getString("url");
        run(call, () -> {
            Collection<Ref> refs = Git.lsRemoteRepository()
                    .setRemote(url)
                    .setHeads(true)
                    .setCredentialsProvider(credentials())
                    .call();
            JSArray branches = new JSArray();
            String defaultBranch = null;
            for (Ref ref : refs) {
                String name = ref.getName().replaceFirst("^refs/heads/", "");
                branches.put(name);
                if (name.equals("main")) defaultBranch = "main";
            }
            if (defaultBranch == null && refs.size() > 0) {
                defaultBranch = refs.iterator().next().getName().replaceFirst("^refs/heads/", "");
            }
            JSObject out = new JSObject();
            out.put("branches", branches);
            if (defaultBranch != null) out.put("defaultBranch", defaultBranch);
            return out;
        });
    }

    @PluginMethod
    public void clone(PluginCall call) {
        String url = call.getString("url");
        String branch = call.getString("branch", "main");
        File dir = repoDir(call);
        run(call, () -> {
            if (new File(dir, ".git").exists()) {
                throw new IllegalStateException("A vault is already cloned on this device.");
            }
            try {
                Git git = Git.cloneRepository()
                        .setURI(url)
                        .setDirectory(dir)
                        .setBranch(branch)
                        .setCredentialsProvider(credentials())
                        .setProgressMonitor(new BridgeMonitor())
                        .call();
                git.close();
            } catch (Exception e) {
                deleteRecursive(dir); // leave no half-cloned state behind
                throw e;
            }
            return new JSObject();
        });
    }

    @PluginMethod
    public void repoInfo(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            JSObject out = new JSObject();
            if (!new File(dir, ".git").exists()) {
                out.put("exists", false);
                return out;
            }
            try (Git git = Git.open(dir)) {
                Repository repo = git.getRepository();
                out.put("exists", true);
                out.put("branch", repo.getBranch());
                out.put("url", repo.getConfig().getString("remote", "origin", "url"));
                ObjectId head = repo.resolve("HEAD");
                if (head != null) out.put("headOid", head.getName());
            }
            return out;
        });
    }

    @PluginMethod
    public void deleteRepo(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            deleteRecursive(dir);
            return new JSObject();
        });
    }

    // ------------------------------------------------------------------
    // Working tree access (bulk operations that would be slow over the bridge)
    // ------------------------------------------------------------------

    @PluginMethod
    public void listFiles(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            JSArray files = new JSArray();
            collectFiles(dir, dir, files);
            JSObject out = new JSObject();
            out.put("files", files);
            return out;
        });
    }

    private void collectFiles(File root, File current, JSArray out) {
        File[] children = current.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.getName().equals(".git")) continue;
            if (child.isDirectory()) {
                collectFiles(root, child, out);
            } else if (child.isFile()) {
                JSObject f = new JSObject();
                f.put("path", relativePath(root, child));
                f.put("mtimeMs", child.lastModified());
                f.put("size", child.length());
                out.put(f);
            }
        }
    }

    private static String relativePath(File root, File file) {
        String rel = root.toURI().relativize(file.toURI()).getPath();
        return rel.endsWith("/") ? rel.substring(0, rel.length() - 1) : rel;
    }

    @PluginMethod
    public void readMany(PluginCall call) {
        File dir = repoDir(call);
        JSArray paths = call.getArray("paths");
        run(call, () -> {
            JSObject contents = new JSObject();
            String rootCanonical = dir.getCanonicalPath();
            List<String> wanted = paths == null ? List.of() : paths.toList();
            for (Object p : wanted) {
                File f = new File(dir, String.valueOf(p));
                if (!f.getCanonicalPath().startsWith(rootCanonical)) continue; // traversal guard
                if (!f.isFile() || f.length() > MAX_TEXT_FILE_BYTES) continue;
                contents.put(String.valueOf(p),
                        new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            }
            JSObject out = new JSObject();
            out.put("contents", contents);
            return out;
        });
    }

    // ------------------------------------------------------------------
    // Local git operations
    // ------------------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                Status st = git.status().call();
                JSArray dirty = new JSArray();
                for (Collection<String> group : List.of(
                        st.getAdded(), st.getChanged(), st.getRemoved(),
                        st.getMissing(), st.getModified(), st.getUntracked(),
                        st.getConflicting())) {
                    for (String path : group) dirty.put(path);
                }
                JSObject out = new JSObject();
                out.put("dirty", dirty);
                return out;
            }
        });
    }

    @PluginMethod
    public void commitAll(PluginCall call) {
        File dir = repoDir(call);
        String message = call.getString("message", "Update vault");
        PersonIdent author = ident(call);
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                stageAll(git);
                Status st = git.status().call();
                JSObject out = new JSObject();
                if (!st.hasUncommittedChanges()) {
                    out.put("committed", false);
                    return out;
                }
                RevCommit commit = git.commit()
                        .setMessage(message)
                        .setAuthor(author)
                        .setCommitter(author)
                        .call();
                out.put("committed", true);
                out.put("oid", commit.getName());
                return out;
            }
        });
    }

    private static void stageAll(Git git) throws Exception {
        git.add().addFilepattern(".").call();                 // new + modified
        git.add().setUpdate(true).addFilepattern(".").call(); // deletions
    }

    private static PersonIdent ident(PluginCall call) {
        String name = call.getString("authorName", "Basalt");
        String email = call.getString("authorEmail", "basalt@localhost");
        return new PersonIdent(name, email);
    }

    @PluginMethod
    public void fetch(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                git.fetch()
                        .setCredentialsProvider(credentials())
                        .setProgressMonitor(new BridgeMonitor())
                        .call();
                Repository repo = git.getRepository();
                BranchTrackingStatus tracking = BranchTrackingStatus.of(repo, repo.getBranch());
                JSObject out = new JSObject();
                out.put("ahead", tracking == null ? 0 : tracking.getAheadCount());
                out.put("behind", tracking == null ? 0 : tracking.getBehindCount());
                return out;
            }
        });
    }

    @PluginMethod
    public void merge(PluginCall call) {
        File dir = repoDir(call);
        String suffix = call.getString("conflictSuffix", "copy");
        PersonIdent author = ident(call);
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                Repository repo = git.getRepository();
                ObjectId remoteHead = repo.resolve("refs/remotes/origin/" + repo.getBranch());
                JSObject out = new JSObject();
                JSArray copies = new JSArray();
                out.put("conflictCopies", copies);
                if (remoteHead == null) {
                    out.put("result", "up-to-date");
                    return out;
                }

                MergeResult mr = git.merge()
                        .include(remoteHead)
                        .setMessage("Merge remote changes")
                        .call();
                MergeResult.MergeStatus status = mr.getMergeStatus();

                if (status == MergeResult.MergeStatus.ALREADY_UP_TO_DATE) {
                    out.put("result", "up-to-date");
                } else if (status == MergeResult.MergeStatus.FAST_FORWARD) {
                    out.put("result", "fast-forward");
                } else if (status.isSuccessful()) {
                    out.put("result", "merged");
                } else if (status == MergeResult.MergeStatus.CONFLICTING) {
                    List<String> created =
                            resolveConflictsKeepingBoth(git, dir, mr.getConflicts().keySet(), suffix, author);
                    for (String c : created) copies.put(c);
                    out.put("result", "conflicts");
                } else {
                    throw new IOException("Merge failed with status " + status);
                }
                return out;
            }
        });
    }

    /**
     * Data-preserving conflict resolution (D-1/D-2): the remote version keeps
     * the original filename, the local version is written next to it as
     * "Name (conflict <suffix>).ext", both are staged, and the merge is
     * committed. Nothing is ever discarded.
     */
    private List<String> resolveConflictsKeepingBoth(
            Git git, File dir, Collection<String> conflictPaths, String suffix, PersonIdent author)
            throws Exception {
        Repository repo = git.getRepository();
        DirCache index = repo.readDirCache();
        List<String> copies = new ArrayList<>();

        for (String path : conflictPaths) {
            ObjectId ours = null;
            ObjectId theirs = null;
            for (int i = 0; i < index.getEntryCount(); i++) {
                DirCacheEntry entry = index.getEntry(i);
                if (!entry.getPathString().equals(path)) continue;
                if (entry.getStage() == DirCacheEntry.STAGE_2) ours = entry.getObjectId();
                if (entry.getStage() == DirCacheEntry.STAGE_3) theirs = entry.getObjectId();
            }

            File original = new File(dir, path);
            if (ours != null && theirs != null) {
                String copyPath = conflictCopyPath(dir, path, suffix);
                writeBlob(repo, ours, new File(dir, copyPath));
                writeBlob(repo, theirs, original);
                copies.add(copyPath);
            } else if (ours != null) {
                // Deleted remotely but edited here: preserve the local edit as a copy.
                String copyPath = conflictCopyPath(dir, path, suffix);
                writeBlob(repo, ours, new File(dir, copyPath));
                if (original.exists() && !original.delete()) {
                    throw new IOException("Could not remove " + path);
                }
                copies.add(copyPath);
            } else if (theirs != null) {
                // Deleted here but edited remotely: the remote edit wins, nothing lost.
                writeBlob(repo, theirs, original);
            }
        }

        stageAll(git);
        git.commit()
                .setMessage("Merge remote changes (kept " + copies.size() + " conflict cop"
                        + (copies.size() == 1 ? "y" : "ies") + ")")
                .setAuthor(author)
                .setCommitter(author)
                .call();
        return copies;
    }

    private static String conflictCopyPath(File dir, String path, String suffix) {
        int slash = path.lastIndexOf('/');
        String folder = slash == -1 ? "" : path.substring(0, slash + 1);
        String name = slash == -1 ? path : path.substring(slash + 1);
        int dot = name.lastIndexOf('.');
        String base = dot <= 0 ? name : name.substring(0, dot);
        String ext = dot <= 0 ? "" : name.substring(dot);
        String candidate = folder + base + " (conflict " + suffix + ")" + ext;
        int n = 2;
        while (new File(dir, candidate).exists()) {
            candidate = folder + base + " (conflict " + suffix + " " + n + ")" + ext;
            n++;
        }
        return candidate;
    }

    private static void writeBlob(Repository repo, ObjectId blob, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Could not create directory " + parent);
        }
        ObjectLoader loader = repo.open(blob);
        try (FileOutputStream out = new FileOutputStream(target)) {
            loader.copyTo(out);
        }
    }

    @PluginMethod
    public void push(PluginCall call) {
        File dir = repoDir(call);
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                Iterable<PushResult> results = git.push()
                        .setCredentialsProvider(credentials())
                        .setProgressMonitor(new BridgeMonitor())
                        .call();
                boolean ok = true;
                boolean rejected = false;
                String message = null;
                for (PushResult result : results) {
                    for (RemoteRefUpdate update : result.getRemoteUpdates()) {
                        RemoteRefUpdate.Status s = update.getStatus();
                        if (s == RemoteRefUpdate.Status.OK || s == RemoteRefUpdate.Status.UP_TO_DATE) {
                            continue;
                        }
                        ok = false;
                        message = update.getMessage();
                        if (s == RemoteRefUpdate.Status.REJECTED_NONFASTFORWARD
                                || s == RemoteRefUpdate.Status.REJECTED_REMOTE_CHANGED) {
                            rejected = true;
                        }
                    }
                }
                JSObject out = new JSObject();
                out.put("ok", ok);
                out.put("rejected", rejected);
                if (message != null) out.put("message", message);
                return out;
            }
        });
    }

    @PluginMethod
    public void log(PluginCall call) {
        File dir = repoDir(call);
        Integer limit = call.getInt("limit", 50);
        String path = call.getString("path");
        run(call, () -> {
            try (Git git = Git.open(dir)) {
                org.eclipse.jgit.api.LogCommand cmd = git.log().setMaxCount(limit == null ? 50 : limit);
                if (path != null && !path.isEmpty()) cmd.addPath(path);
                JSArray commits = new JSArray();
                for (RevCommit commit : cmd.call()) {
                    JSObject c = new JSObject();
                    c.put("oid", commit.getName());
                    c.put("message", commit.getShortMessage());
                    c.put("authorName", commit.getAuthorIdent().getName());
                    c.put("when", commit.getAuthorIdent().getWhen().getTime());
                    commits.put(c);
                }
                JSObject out = new JSObject();
                out.put("commits", commits);
                return out;
            }
        });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void deleteRecursive(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    /** Streams JGit progress to the webview, throttled to ~10 events/second. */
    private class BridgeMonitor implements ProgressMonitor {
        private String task = "";
        private int total;
        private int done;
        private long lastEmit;

        @Override
        public void start(int totalTasks) {}

        @Override
        public void beginTask(String title, int totalWork) {
            task = title;
            total = totalWork;
            done = 0;
            emit(true);
        }

        @Override
        public void update(int completed) {
            done += completed;
            emit(false);
        }

        @Override
        public void endTask() {
            emit(true);
        }

        @Override
        public boolean isCancelled() {
            return false;
        }

        @Override
        public void showDuration(boolean enabled) {}

        private void emit(boolean force) {
            long now = System.currentTimeMillis();
            if (!force && now - lastEmit < 100) return;
            lastEmit = now;
            JSObject data = new JSObject();
            data.put("phase", task);
            data.put("percent", total > 0 ? Math.min(100, done * 100 / total) : -1);
            notifyListeners("progress", data);
        }
    }
}
