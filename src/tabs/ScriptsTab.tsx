import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Spinner,
  Input,
  Textarea,
} from "@fluentui/react-components";
import {
  PlayFilled,
  AddFilled,
  DeleteFilled,
  SaveFilled,
} from "@fluentui/react-icons";

interface ScriptDef {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  working_dir: string | null;
  schedule: string | null;
}

interface ScriptResult {
  id: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

export default function ScriptsTab() {
  const [scripts, setScripts] = useState<ScriptDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Map<string, ScriptResult>>(new Map());
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptDef | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    loadScripts();
  }, []);

  async function loadScripts() {
    setLoading(true);
    try {
      const configDir = getConfigDir();
      const data = await invoke<ScriptDef[]>("load_scripts", { configDir });
      setScripts(data);
    } catch (err) {
      console.error("Failed to load scripts:", err);
    }
    setLoading(false);
  }

  async function handleRun(script: ScriptDef) {
    setRunningId(script.id);
    try {
      const result = await invoke<ScriptResult>("run_script", { script });
      setResults((prev) => new Map(prev).set(script.id, result));
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
    setRunningId(null);
  }

  async function handleSave() {
    try {
      const configDir = getConfigDir();
      await invoke("save_scripts", { configDir, scripts });
      setStatusMsg("Scripts saved");
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  function addScript() {
    const newScript: ScriptDef = {
      id: Date.now().toString(),
      name: "New Script",
      description: "",
      command: "",
      args: [],
      working_dir: null,
      schedule: null,
    };
    setEditing(newScript);
  }

  function saveEdit() {
    if (!editing) return;
    const idx = scripts.findIndex((s) => s.id === editing.id);
    if (idx >= 0) {
      const updated = [...scripts];
      updated[idx] = editing;
      setScripts(updated);
    } else {
      setScripts([...scripts, editing]);
    }
    setEditing(null);
  }

  function deleteScript(id: string) {
    setScripts(scripts.filter((s) => s.id !== id));
  }

  function getConfigDir(): string {
    return (
      (typeof window !== "undefined" &&
        localStorage.getItem("configDir")) ||
      `${getAppData()}/EdgeUtilities`
    );
  }

  function getAppData(): string {
    // Simple fallback
    return "C:\\Users\\champnic\\AppData\\Local";
  }

  if (loading) {
    return (
      <div className="loading">
        <Spinner size="small" />
        <span>Loading scripts...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ flex: 1 }}>
          Scripts & Workflows
        </h2>
        <Button appearance="subtle" icon={<AddFilled />} onClick={addScript}>
          New Script
        </Button>
        <Button
          appearance="subtle"
          icon={<SaveFilled />}
          onClick={handleSave}
        >
          Save All
        </Button>
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

      {/* Script editor dialog */}
      {editing && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <div className="card-header">
            <h3>{editing.id ? "Edit Script" : "New Script"}</h3>
            <Button
              appearance="subtle"
              size="small"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Name
              </label>
              <Input
                value={editing.name}
                onChange={(_e, data) =>
                  setEditing({ ...editing, name: data.value })
                }
                size="small"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Command
              </label>
              <Input
                value={editing.command}
                onChange={(_e, data) =>
                  setEditing({ ...editing, command: data.value })
                }
                size="small"
                placeholder="e.g., git, python, cmd"
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Arguments (one per line)
              </label>
              <Textarea
                value={editing.args.join("\n")}
                onChange={(_e, data) =>
                  setEditing({
                    ...editing,
                    args: data.value.split("\n").filter((a) => a.trim()),
                  })
                }
                rows={3}
                style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Working Directory (optional)
              </label>
              <Input
                value={editing.working_dir || ""}
                onChange={(_e, data) =>
                  setEditing({
                    ...editing,
                    working_dir: data.value || null,
                  })
                }
                size="small"
                placeholder="e.g., d:\edge\src3"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Description
              </label>
              <Input
                value={editing.description}
                onChange={(_e, data) =>
                  setEditing({ ...editing, description: data.value })
                }
                size="small"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button appearance="primary" size="small" onClick={saveEdit}>
              Save Script
            </Button>
          </div>
        </div>
      )}

      {scripts.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📜</div>
          <p>No scripts defined. Click "New Script" to add one.</p>
        </div>
      ) : (
        scripts.map((script) => {
          const result = results.get(script.id);
          const isRunning = runningId === script.id;

          return (
            <div className="card" key={script.id}>
              <div className="card-header">
                <div>
                  <h3>{script.name}</h3>
                  {script.description && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {script.description}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button
                    appearance="primary"
                    icon={isRunning ? <Spinner size="tiny" /> : <PlayFilled />}
                    size="small"
                    onClick={() => handleRun(script)}
                    disabled={isRunning}
                  >
                    {isRunning ? "Running..." : "Run"}
                  </Button>
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => setEditing({ ...script })}
                  >
                    Edit
                  </Button>
                  <Button
                    appearance="subtle"
                    icon={<DeleteFilled />}
                    size="small"
                    onClick={() => deleteScript(script.id)}
                  />
                </div>
              </div>

              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginBottom: result ? 8 : 0,
                }}
              >
                $ {script.command} {script.args.join(" ")}
                {script.working_dir && (
                  <span style={{ marginLeft: 8 }}>
                    (in {script.working_dir})
                  </span>
                )}
              </div>

              {result && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      className={`badge ${
                        result.exit_code === 0 ? "success" : "error"
                      }`}
                    >
                      Exit: {result.exit_code}
                    </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Duration: {result.duration_ms}ms
                    </span>
                  </div>
                  <div className="terminal-output">
                    {result.stdout}
                    {result.stderr && (
                      <span className="error">{result.stderr}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
