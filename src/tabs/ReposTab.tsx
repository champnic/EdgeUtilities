import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Spinner,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowSyncFilled,
  BuildingFilled,
  AddFilled,
  DocumentTextFilled,
  DeleteFilled,
  ChevronDownFilled,
  ChevronRightFilled,
  WindowConsoleFilled,
  ReOrderFilled,
  ArrowDownloadFilled,
  SearchFilled,
} from "@fluentui/react-icons";
import StatusBar from "../components/StatusBar";

interface OutDir {
  name: string;
  path: string;
  has_args_gn: boolean;
}

interface CommitInfo {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  date: string;
}

interface RepoInfo {
  path: string;
  current_branch: string;
  out_dirs: OutDir[];
  recent_commits: CommitInfo[];
  merge_base_index: number | null;
}

interface RepoState {
  info: RepoInfo | null;
  branch: string;
  loading: boolean;
  expanded: boolean;
  error: string;
  loadingMsg: string;
  fullLoaded: boolean;
  commitsExpanded: boolean;
}

export default function ReposTab() {
  const [repoPaths, setRepoPaths] = useState<string[]>([]);
  const [repoStates, setRepoStates] = useState<Map<string, RepoState>>(new Map());
  const [newRepoPath, setNewRepoPath] = useState("");
  const [buildTargets, setBuildTargets] = useState<string[]>([]);
  const [buildState, setBuildState] = useState<{
    repoPath: string;
    outDirPath: string;
    selectedTarget: string;
    customTarget: string;
    building: boolean;
    output: string;
  } | null>(null);
  const [argsGnView, setArgsGnView] = useState<{ repoPath: string; outDirPath: string; content: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [newOutConfig, setNewOutConfig] = useState("win_x64_debug_developer_build");
  const [newOutPath, setNewOutPath] = useState("");
  const [creatingOutDir, setCreatingOutDir] = useState(false);
  const [addOutDirExpanded, setAddOutDirExpanded] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const repoCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const configDir = "C:\\EdgeUtilities";

  // Load repo list on mount
  useEffect(() => {
    loadRepoList();
    invoke<string[]>("get_common_build_targets").then(setBuildTargets).catch(() => {});
  }, []);

  async function loadRepoList() {
    try {
      const paths = await invoke<string[]>("load_repo_list", { configDir });
      setRepoPaths(paths);
      // Load info for each repo
      for (const p of paths) {
        loadRepoInfo(p);
      }
    } catch {
      setRepoPaths([]);
    }
  }

  async function loadRepoInfo(repoPath: string) {
    setRepoStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(repoPath);
      next.set(repoPath, {
        info: existing?.info ?? null,
        branch: existing?.branch ?? "",
        loading: true,
        expanded: existing?.expanded ?? false,
        error: "",
        loadingMsg: "Fetching branch...",
        fullLoaded: false,
        commitsExpanded: existing?.commitsExpanded ?? false,
      });
      return next;
    });

    try {
      const branch = await invoke<string>("get_repo_branch", { repoPath });
      setRepoStates((prev) => {
        const next = new Map(prev);
        const existing = next.get(repoPath);
        next.set(repoPath, {
          info: existing?.info ?? null,
          branch,
          loading: false,
          expanded: existing?.expanded ?? false,
          error: "",
          loadingMsg: "",
          fullLoaded: false,
          commitsExpanded: existing?.commitsExpanded ?? false,
        });
        return next;
      });
    } catch (err) {
      setRepoStates((prev) => {
        const next = new Map(prev);
        next.set(repoPath, {
          info: null,
          branch: "",
          loading: false,
          expanded: false,
          error: `${err}`,
          loadingMsg: "",
          fullLoaded: false,
          commitsExpanded: false,
        });
        return next;
      });
    }
  }

  async function loadFullRepoInfo(repoPath: string) {
    setRepoStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(repoPath);
      if (existing) {
        next.set(repoPath, { ...existing, loading: true, loadingMsg: "Loading details..." });
      }
      return next;
    });

    try {
      const info = await invoke<RepoInfo>("get_repo_info", { repoPath });
      setRepoStates((prev) => {
        const next = new Map(prev);
        next.set(repoPath, {
          info,
          branch: info.current_branch,
          loading: false,
          expanded: true,
          error: "",
          loadingMsg: "",
          fullLoaded: true,
          commitsExpanded: false,
        });
        return next;
      });
    } catch (err) {
      setRepoStates((prev) => {
        const next = new Map(prev);
        const existing = next.get(repoPath);
        next.set(repoPath, {
          info: existing?.info ?? null,
          branch: existing?.branch ?? "",
          loading: false,
          expanded: true,
          error: `${err}`,
          loadingMsg: "",
          fullLoaded: false,
          commitsExpanded: existing?.commitsExpanded ?? false,
        });
        return next;
      });
    }
  }

  function toggleRepo(repoPath: string) {
    setRepoStates((prev) => {
      const next = new Map(prev);
      const state = next.get(repoPath);
      if (state) {
        const willExpand = !state.expanded;
        next.set(repoPath, { ...state, expanded: willExpand });
        // Load full info on first expand
        if (willExpand && !state.fullLoaded) {
          setTimeout(() => loadFullRepoInfo(repoPath), 0);
        }
      }
      return next;
    });
  }

  async function openEdgeDevEnv(repoPath: string) {
    try {
      await invoke("open_edge_dev_env", { repoPath });
    } catch (err) {
      setStatusMsg(`Error opening dev environment: ${err}`);
    }
  }

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);

    const handlePointerMove = (e: PointerEvent) => {
      // Find which card the pointer is over
      let foundIndex: number | null = null;
      repoCardRefs.current.forEach((el, idx) => {
        if (el) {
          const rect = el.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            foundIndex = idx;
          }
        }
      });
      setDragOverIndex(foundIndex);
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);

      setDragIndex((currentDragIndex) => {
        setDragOverIndex((currentDragOverIndex) => {
          if (
            currentDragIndex !== null &&
            currentDragOverIndex !== null &&
            currentDragIndex !== currentDragOverIndex
          ) {
            setRepoPaths((prev) => {
              const updated = [...prev];
              const [moved] = updated.splice(currentDragIndex, 1);
              updated.splice(currentDragOverIndex, 0, moved);
              invoke("save_repo_list", { configDir, repos: updated }).catch(() => {});
              return updated;
            });
          }
          return null;
        });
        return null;
      });
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  }, [configDir]);

  async function addRepo() {
    if (!newRepoPath.trim() || repoPaths.includes(newRepoPath.trim())) return;
    const updated = [...repoPaths, newRepoPath.trim()];
    setRepoPaths(updated);
    setNewRepoPath("");
    loadRepoInfo(newRepoPath.trim());
    try {
      await invoke("save_repo_list", { configDir, repos: updated });
    } catch {}
  }

  async function removeRepo(path: string) {
    const updated = repoPaths.filter((p) => p !== path);
    setRepoPaths(updated);
    setRepoStates((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
    try {
      await invoke("save_repo_list", { configDir, repos: updated });
    } catch {}
  }

  function toggleBuildPanel(repoPath: string, outDirPath: string) {
    if (buildState?.outDirPath === outDirPath) {
      setBuildState(null);
    } else {
      setBuildState({
        repoPath,
        outDirPath,
        selectedTarget: "chrome",
        customTarget: "",
        building: false,
        output: "",
      });
    }
  }

  async function handleBuild() {
    if (!buildState) return;
    const target = buildState.customTarget || buildState.selectedTarget;
    if (!target) {
      setStatusMsg("Select a build target");
      return;
    }
    setBuildState((prev) => prev ? { ...prev, building: true, output: "" } : prev);
    try {
      const result = await invoke<string>("start_build", {
        repoPath: buildState.repoPath,
        outDir: buildState.outDirPath,
        target,
      });
      setBuildState((prev) => prev ? { ...prev, building: false, output: result } : prev);
    } catch (err) {
      setBuildState((prev) => prev ? { ...prev, building: false, output: `Build failed:\n${err}` } : prev);
    }
  }

  async function handleCreateOutDir(repoPath: string) {
    if (!newOutConfig) {
      setStatusMsg("Enter a config name");
      return;
    }
    setCreatingOutDir(true);
    try {
      const outPath = newOutPath || `out/${newOutConfig}`;
      const result = await invoke<string>("create_out_dir", {
        repoPath,
        configName: newOutConfig,
        outPath,
      });
      setStatusMsg(result);
      loadRepoInfo(repoPath);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
    setCreatingOutDir(false);
  }

  async function viewArgsGn(repoPath: string, outDirPath: string) {
    if (argsGnView?.outDirPath === outDirPath) {
      setArgsGnView(null);
      return;
    }
    try {
      const content = await invoke<string>("read_args_gn", { outDirPath });
      setArgsGnView({ repoPath, outDirPath, content });
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ flex: 1 }}>
          Repositories
        </h2>
      </div>

      <StatusBar message={statusMsg} tab="Repos" onDismiss={() => setStatusMsg("")} />

      {/* Add repo */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Input
          value={newRepoPath}
          onChange={(_e, data) => setNewRepoPath(data.value)}
          placeholder="Add repo path (e.g., d:\edge\src)"
          style={{ flex: 1 }}
          size="small"
          onKeyDown={(e) => { if (e.key === "Enter") addRepo(); }}
        />
        <Button
          appearance="subtle"
          icon={<AddFilled />}
          size="small"
          onClick={addRepo}
        >
          Add Repo
        </Button>
        <Button
          appearance="subtle"
          icon={<SearchFilled />}
          size="small"
          onClick={async () => {
            try {
              const detected = await invoke<string[]>("detect_repos");
              if (detected.length === 0) {
                setStatusMsg("No Edge repos found on disk.");
                return;
              }
              const newPaths = detected.filter((d) => !repoPaths.includes(d));
              if (newPaths.length === 0) {
                setStatusMsg("All detected repos are already added.");
                return;
              }
              const updated = [...repoPaths, ...newPaths];
              setRepoPaths(updated);
              for (const p of newPaths) loadRepoInfo(p);
              await invoke("save_repo_list", { configDir, repos: updated });
              setStatusMsg(`Found ${newPaths.length} new repo(s).`);
            } catch (e) {
              setStatusMsg(`Scan failed: ${e}`);
            }
          }}
        >
          Scan
        </Button>
      </div>

      {/* Repo list */}
      {repoPaths.map((repoPath, index) => {
        const state = repoStates.get(repoPath) ?? {
          info: null,
          branch: "",
          loading: true,
          expanded: false,
          error: "",
          loadingMsg: "",
          fullLoaded: false,
          commitsExpanded: false,
        };

        return (
          <div
            key={repoPath}
            ref={(el) => { if (el) repoCardRefs.current.set(index, el); }}
            className="card"
            style={{
              padding: 0,
              marginBottom: 8,
              borderTop: dragOverIndex === index && dragIndex !== null && dragIndex !== index
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              opacity: dragIndex === index ? 0.5 : 1,
              transition: "border-color 0.15s ease, opacity 0.15s ease",
            }}
          >
            {/* Collapsible header */}
            <div
              className="process-group-header"
              style={{ cursor: "pointer", borderRadius: state.expanded ? "8px 8px 0 0" : "8px" }}
              onClick={() => toggleRepo(repoPath)}
            >
              <span
                style={{ fontSize: 14, cursor: "grab", color: "var(--text-secondary)", display: "flex", alignItems: "center", touchAction: "none" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  handleDragStart(index);
                }}
                title="Drag to reorder"
              >
                <ReOrderFilled />
              </span>
              <span style={{ fontSize: 12 }}>
                {state.expanded ? <ChevronDownFilled /> : <ChevronRightFilled />}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 13, flex: 1 }}>
                {repoPath}
              </span>
              {state.loading && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  <Spinner size="tiny" /> {state.loadingMsg}
                </span>
              )}
              {state.branch && (
                <span style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: /rebase|merge|cherry-pick|revert|bisect|detached/i.test(state.branch) ? "#ff9800" : "#4fc3f7",
                  fontFamily: "monospace",
                }}>
                  {state.branch}
                </span>
              )}
              {state.error && (
                <span style={{ fontSize: 11, color: "var(--danger)" }}>Error</span>
              )}
              <Button
                appearance="subtle"
                icon={<ArrowDownloadFilled />}
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  invoke("run_gclient_sync", { repoPath })
                    .then(() => setStatusMsg("gclient sync started in new terminal"))
                    .catch((err) => setStatusMsg(`Error: ${err}`));
                }}
                title="gclient sync -f -D"
              />
              <Button
                appearance="subtle"
                icon={<WindowConsoleFilled />}
                size="small"
                onClick={(e) => { e.stopPropagation(); openEdgeDevEnv(repoPath); }}
                title="Open Edge Dev Environment"
              />
              <Button
                appearance="subtle"
                icon={<ArrowSyncFilled />}
                size="small"
                onClick={(e) => { e.stopPropagation(); loadRepoInfo(repoPath); }}
                title="Refresh"
              />
              <Button
                appearance="subtle"
                icon={<DeleteFilled />}
                size="small"
                onClick={(e) => { e.stopPropagation(); removeRepo(repoPath); }}
                title="Remove repo"
              />
            </div>

            {/* Expanded content */}
            {state.expanded && (
              <div style={{ padding: 16 }}>
                {state.error && (
                  <p style={{ color: "var(--danger)", fontSize: 13 }}>{state.error}</p>
                )}

                {state.info && (
                  <>
                    {/* Out Dirs */}
                    <div style={{ marginBottom: 16 }}>
                      <h4 style={{ fontSize: 13, marginBottom: 8, color: "var(--text-secondary)" }}>
                        Out Directories ({state.info.out_dirs.length})
                      </h4>
                      {state.info.out_dirs.length > 0 && (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>args.gn</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {state.info.out_dirs.map((dir, i) => (
                              <tr key={i}>
                                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{dir.name}</td>
                                <td>
                                  <span className={`badge ${dir.has_args_gn ? "success" : "error"}`}>
                                    {dir.has_args_gn ? "Yes" : "No"}
                                  </span>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {dir.has_args_gn && (
                                    <Button
                                      appearance="subtle"
                                      icon={<DocumentTextFilled />}
                                      size="small"
                                      onClick={() => viewArgsGn(repoPath, dir.path)}
                                    >
                                      args.gn
                                    </Button>
                                  )}
                                  <Button
                                    appearance={buildState?.outDirPath === dir.path ? "primary" : "subtle"}
                                    icon={<BuildingFilled />}
                                    size="small"
                                    onClick={() => toggleBuildPanel(repoPath, dir.path)}
                                    title="Build this out dir"
                                  >
                                    Build
                                  </Button>
                                  <Button
                                    appearance="subtle"
                                    icon={<DeleteFilled />}
                                    size="small"
                                    onClick={async () => {
                                      if (!confirm(`Delete out folder "${dir.name}"? This cannot be undone.`)) return;
                                      try {
                                        const result = await invoke<string>("delete_out_dir", { outDirPath: dir.path });
                                        setStatusMsg(result);
                                        loadFullRepoInfo(repoPath);
                                      } catch (err) {
                                        setStatusMsg(`Error: ${err}`);
                                      }
                                    }}
                                    title="Delete out folder"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {argsGnView && argsGnView.repoPath === repoPath && (
                        <div style={{ marginTop: 8, background: "rgba(0,0,0,0.15)", borderRadius: 6, padding: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                              args.gn — {argsGnView.outDirPath.split(/[/\\]/).pop()}
                            </span>
                            <Button appearance="subtle" size="small" onClick={() => setArgsGnView(null)}>
                              Close
                            </Button>
                          </div>
                          <Textarea
                            value={argsGnView.content}
                            readOnly
                            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                            rows={12}
                          />
                        </div>
                      )}

                      {buildState && buildState.repoPath === repoPath && (
                        <div style={{ marginTop: 8, background: "rgba(0,0,0,0.15)", borderRadius: 6, padding: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                              Build: {buildState.outDirPath.split(/[/\\]/).pop()}
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Target:</span>
                            <Select
                              value={buildState.selectedTarget}
                              onChange={(_e, data) => setBuildState((prev) => prev ? { ...prev, selectedTarget: data.value } : prev)}
                              size="small"
                              style={{ minWidth: 140 }}
                            >
                              {buildTargets.map((target, i) => (
                                <option key={i} value={target}>{target}</option>
                              ))}
                              <option value="">Custom...</option>
                            </Select>
                            {buildState.selectedTarget === "" && (
                              <Input
                                value={buildState.customTarget}
                                onChange={(_e, data) => setBuildState((prev) => prev ? { ...prev, customTarget: data.value } : prev)}
                                placeholder="Custom target"
                                size="small"
                                style={{ flex: 1 }}
                              />
                            )}
                            <Button
                              appearance="primary"
                              icon={<BuildingFilled />}
                              size="small"
                              onClick={handleBuild}
                              disabled={buildState.building}
                            >
                              {buildState.building ? "Building..." : "Build"}
                            </Button>
                            <Button appearance="subtle" size="small" onClick={() => setBuildState(null)}>
                              Close
                            </Button>
                          </div>

                          {buildState.building && (
                            <div className="loading" style={{ padding: 8 }}>
                              <Spinner size="tiny" />
                              <span style={{ fontSize: 12 }}>Building {buildState.customTarget || buildState.selectedTarget}...</span>
                            </div>
                          )}

                          {buildState.output && (
                            <div className="terminal-output" style={{ marginTop: 8, maxHeight: 200 }}>
                              {buildState.output}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ marginTop: 8 }}>
                        <Button
                          appearance="subtle"
                          icon={addOutDirExpanded === repoPath ? <ChevronDownFilled /> : <AddFilled />}
                          size="small"
                          onClick={() => setAddOutDirExpanded(addOutDirExpanded === repoPath ? null : repoPath)}
                        >
                          Add Out Directory
                        </Button>
                        {addOutDirExpanded === repoPath && (
                          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                            <Select
                              value={newOutConfig}
                              onChange={(_e, data) => setNewOutConfig(data.value)}
                              size="small"
                              style={{ flex: 1, minWidth: 220 }}
                            >
                              <optgroup label="Developer Builds">
                                <option value="win_x64_debug_developer_build">win_x64_debug_developer_build</option>
                                <option value="win_x64_debug_full_developer_build">win_x64_debug_full_developer_build</option>
                                <option value="win_x64_release_developer_build">win_x64_release_developer_build</option>
                                <option value="mac_arm64_debug_developer_build">mac_arm64_debug_developer_build</option>
                                <option value="mac_arm64_debug_full_developer_build">mac_arm64_debug_full_developer_build</option>
                                <option value="mac_arm64_release_developer_build">mac_arm64_release_developer_build</option>
                                <option value="mac_x64_debug_developer_build">mac_x64_debug_developer_build</option>
                                <option value="mac_x64_debug_full_developer_build">mac_x64_debug_full_developer_build</option>
                                <option value="mac_x64_release_developer_build">mac_x64_release_developer_build</option>
                                <option value="linux_x64_debug_developer_build">linux_x64_debug_developer_build</option>
                                <option value="linux_x64_debug_full_developer_build">linux_x64_debug_full_developer_build</option>
                                <option value="linux_x64_release_developer_build">linux_x64_release_developer_build</option>
                              </optgroup>
                              <optgroup label="Sanitizer Builds">
                                <option value="win_x64_asan_libfuzz_release">win_x64_asan_libfuzz_release</option>
                                <option value="win_x64_asan_release">win_x64_asan_release</option>
                                <option value="linux_x64_release_asan">linux_x64_release_asan</option>
                                <option value="linux_x64_release_msan">linux_x64_release_msan</option>
                                <option value="mac_x64_Release_asan">mac_x64_Release_asan</option>
                              </optgroup>
                              <optgroup label="Official Builds">
                                <option value="win_x64_official">win_x64_official</option>
                                <option value="win_arm64_official">win_arm64_official</option>
                                <option value="mac_x64_Official">mac_x64_Official</option>
                                <option value="mac_arm64_Official">mac_arm64_Official</option>
                                <option value="linux_x64_official">linux_x64_official</option>
                              </optgroup>
                            </Select>
                            <Input
                              value={newOutPath}
                              onChange={(_e, data) => setNewOutPath(data.value)}
                              placeholder="Path (optional)"
                              size="small"
                              style={{ flex: 1 }}
                            />
                            <Button
                              appearance="subtle"
                              icon={<AddFilled />}
                              size="small"
                              onClick={() => handleCreateOutDir(repoPath)}
                              disabled={creatingOutDir}
                            >
                              {creatingOutDir ? "Creating..." : "Create"}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recent Commits */}
                    <div>
                      <h4
                        style={{ fontSize: 13, marginBottom: 8, color: "var(--text-secondary)", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}
                        onClick={() => {
                          setRepoStates((prev) => {
                            const next = new Map(prev);
                            const s = next.get(repoPath);
                            if (s) next.set(repoPath, { ...s, commitsExpanded: !s.commitsExpanded });
                            return next;
                          });
                        }}
                      >
                        <span style={{ fontSize: 12 }}>
                          {state.commitsExpanded ? <ChevronDownFilled /> : <ChevronRightFilled />}
                        </span>
                        Recent Commits
                      </h4>
                      {state.commitsExpanded && (() => {
                        const mbi = state.info.merge_base_index;
                        // Show commits up to and including the merge-base
                        const displayCommits = mbi != null
                          ? state.info.recent_commits.slice(0, mbi + 1)
                          : state.info.recent_commits;
                        return (
                          <ul className="commit-list">
                            {displayCommits.map((commit, i) => {
                              const isMergeBase = mbi != null && i === mbi;
                              return (
                                <li key={i} style={isMergeBase ? { borderTop: "1px solid #4fc3f7", paddingTop: 6, marginTop: 4 } : undefined}>
                                  {isMergeBase && (
                                    <div style={{ fontSize: 11, fontWeight: 700, color: "#4fc3f7", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ background: "#4fc3f7", color: "#000", borderRadius: 3, padding: "1px 6px", fontSize: 10, fontWeight: 800 }}>MAIN</span>
                                      <span style={{ color: "#aaa" }}>Branched from main on {commit.date}</span>
                                    </div>
                                  )}
                                  <span className="hash">{commit.short_hash}</span>
                                  <span className="date" style={isMergeBase ? { color: "#4fc3f7", fontWeight: 600 } : undefined}>{commit.date}</span>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {commit.subject}
                                  </span>
                                </li>
                              );
                            })}
                            {mbi != null && mbi < state.info.recent_commits.length - 1 && (
                              <li style={{ color: "#666", fontStyle: "italic", fontSize: 11, paddingTop: 2 }}>
                                {state.info.recent_commits.length - mbi - 1} earlier commit(s) on main not shown
                              </li>
                            )}
                          </ul>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
