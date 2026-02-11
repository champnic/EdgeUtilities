import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Spinner, Switch } from "@fluentui/react-components";
import {
  ArrowSyncFilled,
  DismissCircleFilled,
  BugFilled,
} from "@fluentui/react-icons";

interface ProcessInfo {
  pid: number;
  parent_pid: number | null;
  name: string;
  exe_path: string;
  cmd_args: string[];
  process_type: string;
  memory_mb: number;
  cpu_percent: number;
  url: string;
  cdp_target_type: string;
  instance_type: string;
}

interface ProcessGroup {
  browser_pid: number;
  browser_exe: string;
  channel: string;
  instance_type: string;
  host_app: string;
  processes: ProcessInfo[];
}

const STORAGE_KEY_AUTO_REFRESH = "edge-utils-processes-auto-refresh";
const STORAGE_KEY_HIDDEN_TYPES = "edge-utils-processes-hidden-types";
const STORAGE_KEY_SHOW_ARGS = "edge-utils-processes-show-args";

function getProcessDetail(proc: ProcessInfo): string {
  if (proc.url) return proc.url;
  if (proc.process_type === "Utility") {
    const sub = proc.cmd_args.find((a) => a.startsWith("--utility-sub-type="));
    if (sub) {
      const val = sub.replace("--utility-sub-type=", "");
      // Shorten long Mojo interface names: take last segment
      const parts = val.split(".");
      return parts.length > 1 ? parts[parts.length - 1] : val;
    }
  }
  return "";
}

const ALL_INSTANCE_TYPES = ["Stable", "Beta", "Dev", "Canary", "Internal", "WebView2", "Copilot"] as const;

function loadHiddenTypes(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HIDDEN_TYPES);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  // WebView2 hidden by default
  return new Set(["WebView2"]);
}

function saveHiddenTypes(hidden: Set<string>) {
  localStorage.setItem(STORAGE_KEY_HIDDEN_TYPES, JSON.stringify([...hidden]));
}

export default function ProcessesTab() {
  const [groups, setGroups] = useState<ProcessGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [statusMsg, setStatusMsg] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTO_REFRESH) === "true";
    } catch { return false; }
  });
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(loadHiddenTypes);
  const [showArgs, setShowArgs] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY_SHOW_ARGS) === "true"; } catch { return false; }
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await invoke<ProcessGroup[]>("get_edge_processes");
      // Preserve existing CDP URLs when refreshing process list
      setGroups((prev) => {
        // Build a map of pid -> (url, cdp_target_type) from previous state
        const urlMap = new Map<number, { url: string; cdp_target_type: string }>();
        for (const g of prev) {
          for (const p of g.processes) {
            if (p.url) urlMap.set(p.pid, { url: p.url, cdp_target_type: p.cdp_target_type });
          }
        }
        // Carry forward URLs to matching PIDs in the new data
        return data.map((group) => ({
          ...group,
          processes: group.processes.map((proc) => {
            const prev = urlMap.get(proc.pid);
            return prev ? { ...proc, url: prev.url, cdp_target_type: prev.cdp_target_type } : proc;
          }),
        }));
      });
      // Auto-expand all groups on first load (except WebView2)
      if (showLoading) {
        setExpandedGroups(new Set(
          data.filter((g) => g.instance_type !== "WebView2").map((g) => g.browser_pid)
        ));
      }
      // Fetch CDP URLs in the background and merge into process data
      invoke<Record<string, { process_id: number | null; url: string; target_type: string | null }[]>>("get_cdp_urls").then((portMap) => {
        if (!portMap || Object.keys(portMap).length === 0) return;

        setGroups((prev) => {
          let changed = false;
          const next = prev.map((group) => {
            const browser = group.processes.find((p) => p.process_type === "Browser");
            if (!browser) return group;
            const portArg = browser.cmd_args.find((a) => a.startsWith("--remote-debugging-port="));
            const port = portArg?.split("=")[1];
            if (!port || !portMap[port]) return group;

            const pages = portMap[port];
            let groupChanged = false;
            const updatedProcesses = group.processes.map((proc) => {
              const match = pages.find((p) => p.process_id && p.process_id === proc.pid);
              if (match && (match.url !== proc.url || (match.target_type ?? "") !== proc.cdp_target_type)) {
                groupChanged = true;
                return { ...proc, url: match.url, cdp_target_type: match.target_type ?? "" };
              }
              return proc;
            });

            if (!groupChanged) return group;
            changed = true;
            return { ...group, processes: updatedProcesses };
          });
          return changed ? next : prev;
        });
      }).catch(() => { /* CDP not available, ignore */ });
    } catch (err) {
      console.error("Failed to get processes:", err);
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => refresh(false), 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refresh]);

  async function handleTerminate(pid: number) {
    try {
      const result = await invoke<string>("terminate_process", { pid });
      setStatusMsg(result);
      setTimeout(() => refresh(false), 1000);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleDebug(pid: number, includeChildren: boolean) {
    try {
      const result = await invoke<string>("debug_process", {
        pid,
        includeChildren,
      });
      setStatusMsg(result);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  function toggleGroup(pid: number) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }

  function getTypeBadgeClass(type: string): string {
    return type.toLowerCase();
  }

  const typeOrder: Record<string, number> = {
    browser: 0,
    renderer: 1,
    gpu: 2,
    crashpad: 3,
    utility: 4,
  };

  function sortProcesses(procs: ProcessInfo[]): ProcessInfo[] {
    return [...procs].sort((a, b) => {
      const aOrder = typeOrder[a.process_type.toLowerCase().replace(/\(s\)$/, "")] ?? 99;
      const bOrder = typeOrder[b.process_type.toLowerCase().replace(/\(s\)$/, "")] ?? 99;
      return aOrder - bOrder;
    });
  }

  function getTotalMemory(procs: ProcessInfo[]): number {
    return Math.round(procs.reduce((sum, p) => sum + p.memory_mb, 0) * 100) / 100;
  }

  function getGroupLabel(group: ProcessGroup): string {
    if (group.instance_type === "WebView2") return "WebView2";
    if (group.instance_type === "Copilot") return "Copilot";
    return group.channel;
  }

  function hasRemoteDebugging(group: ProcessGroup): boolean {
    const browser = group.processes.find((p) => p.process_type === "Browser");
    if (!browser) return false;
    return browser.cmd_args.some((a) => a.startsWith("--remote-debugging-port="));
  }

  if (loading) {
    return (
      <div className="loading">
        <Spinner size="small" />
        <span>Scanning for Edge processes...</span>
      </div>
    );
  }

  const totalProcesses = groups.reduce((sum, g) => sum + g.processes.length, 0);

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ flex: 1 }}>
          Edge Processes
          <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 8 }}>
            ({totalProcesses} processes in {groups.length} groups)
          </span>
        </h2>
        <Switch
          checked={autoRefresh}
          onChange={(_e, data) => {
            setAutoRefresh(data.checked);
            localStorage.setItem(STORAGE_KEY_AUTO_REFRESH, String(data.checked));
          }}
          label="Auto-refresh"
        />
        <Switch
          checked={showArgs}
          onChange={(_e, data) => {
            setShowArgs(data.checked);
            localStorage.setItem(STORAGE_KEY_SHOW_ARGS, String(data.checked));
          }}
          label="Args"
        />
        <Button
          appearance="subtle"
          icon={<ArrowSyncFilled />}
          onClick={() => refresh()}
        >
          Refresh
        </Button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", marginRight: 4 }}>Show:</span>
        {ALL_INSTANCE_TYPES.map((type) => {
          const count = groups.filter((g) => getGroupLabel(g) === type || (type === "Stable" && !["Beta", "Dev", "Canary", "Internal", "WebView2", "Copilot"].includes(getGroupLabel(g)))).length;
          const isVisible = !hiddenTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => {
                setHiddenTypes((prev) => {
                  const next = new Set(prev);
                  if (next.has(type)) next.delete(type); else next.add(type);
                  saveHiddenTypes(next);
                  return next;
                });
              }}
              style={{
                padding: "2px 8px",
                fontSize: 11,
                borderRadius: 4,
                border: `1px solid ${isVisible ? "var(--accent)" : "rgba(255,255,255,0.15)"}`,
                background: isVisible ? "rgba(0,120,212,0.15)" : "transparent",
                color: isVisible ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
                opacity: count === 0 && !isVisible ? 0.4 : 1,
              }}
            >
              {type}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {statusMsg && (
        <div className="card" style={{ marginBottom: 12 }}>
          <span>{statusMsg}</span>
          <Button
            appearance="subtle"
            size="small"
            onClick={() => setStatusMsg("")}
            style={{ marginLeft: 8 }}
          >
            Dismiss
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          <div className="icon">&#9889;</div>
          <p>No Edge processes running</p>
        </div>
      ) : (
        groups.filter((group) => {
          const label = getGroupLabel(group);
          // Match filter: known types match directly, unknown channels match "Stable"
          if (hiddenTypes.has(label)) return false;
          if (!["WebView2", "Copilot", "Beta", "Dev", "Canary", "Internal"].includes(label) && hiddenTypes.has("Stable")) return false;
          return true;
        }).map((group) => (
          <div className="process-group" key={group.browser_pid}>
            <div
              className="process-group-header"
              onClick={() => toggleGroup(group.browser_pid)}
              style={{ cursor: "pointer" }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                {expandedGroups.has(group.browser_pid) ? "\u25BC" : "\u25B6"}
              </span>
              <span className={`badge ${group.instance_type === "WebView2" ? "webview2" : group.instance_type === "Copilot" ? "copilot" : group.channel.toLowerCase().replace(" ", "-")}`}>
                {getGroupLabel(group)}
              </span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                PID {group.browser_pid}
              </span>
              {group.host_app && (
                <span style={{ fontSize: 12, color: "var(--text-primary)", fontStyle: "italic" }}>
                  {group.host_app}
                </span>
              )}
              {hasRemoteDebugging(group) && (
                <span style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: "rgba(0,180,80,0.15)",
                  color: "#00b450",
                  border: "1px solid rgba(0,180,80,0.3)",
                  fontWeight: 600,
                }}>
                  CDP
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {group.processes.length} proc &middot; {getTotalMemory(group.processes)} MB
              </span>
            </div>

            {expandedGroups.has(group.browser_pid) && (
              <table
                className="data-table"
                style={{
                  borderLeft: "1px solid rgba(0,120,212,0.2)",
                  borderRight: "1px solid rgba(0,120,212,0.2)",
                  borderBottom: "1px solid rgba(0,120,212,0.2)",
                  borderRadius: "0 0 6px 6px",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>PID</th>
                    <th style={{ width: 80 }}>Type</th>
                    <th style={{ width: 70 }}>Memory</th>
                    <th style={{ width: 50 }}>CPU</th>
                    <th>Details</th>
                    {showArgs && <th>Args</th>}
                    <th style={{ width: 70 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortProcesses(group.processes).map((proc) => {
                    const detail = getProcessDetail(proc);
                    return (
                    <tr key={proc.pid}>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{proc.pid}</td>
                      <td>
                        <span className={`badge ${getTypeBadgeClass(proc.process_type)}`}>
                          {proc.process_type}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{proc.memory_mb} MB</td>
                      <td style={{ fontSize: 12 }}>{proc.cpu_percent.toFixed(1)}%</td>
                      <td
                        style={{
                          fontSize: 11,
                          maxWidth: 350,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={detail}
                      >
                        {detail ? (
                          <span style={{ color: "var(--text-primary)", fontFamily: proc.url ? "inherit" : "monospace" }}>
                            {proc.cdp_target_type ? (
                              <span className="badge" style={{ fontSize: 9, padding: "1px 4px", marginRight: 4, background: "var(--colorNeutralBackground3)", border: "1px solid var(--colorNeutralStroke2)" }}>{proc.cdp_target_type}</span>
                            ) : null}
                            {detail}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-secondary)", fontSize: 10 }}>—</span>
                        )}
                      </td>
                      {showArgs && (
                        <td
                          style={{
                            fontSize: 10,
                            maxWidth: 300,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily: "monospace",
                            color: "var(--text-secondary)",
                          }}
                          title={proc.cmd_args.join(" ")}
                        >
                          {proc.cmd_args
                            .slice(1)
                            .filter((a) => a.startsWith("--") && !a.startsWith("--type=") && !a.startsWith("--mojo") && !a.startsWith("--field-trial") && !a.startsWith("--remote-debugging-port") && !a.startsWith("--subproc-heap-profiling") && !a.startsWith("--utility-sub-type"))
                            .slice(0, 3)
                            .join(" ")}
                        </td>
                      )}
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button
                          appearance="subtle"
                          icon={<DismissCircleFilled />}
                          size="small"
                          onClick={() => handleTerminate(proc.pid)}
                          title="Terminate"
                        />
                        <Button
                          appearance="subtle"
                          icon={<BugFilled />}
                          size="small"
                          onClick={() => handleDebug(proc.pid, false)}
                          title="Debug"
                        />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
    </div>
  );
}
