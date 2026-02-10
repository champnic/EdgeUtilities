import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Spinner,
  Input,
  Textarea,
  Switch,
} from "@fluentui/react-components";
import {
  PlayFilled,
  AddFilled,
  DeleteFilled,
  SaveFilled,
  CalendarClockFilled,
  ChevronDownFilled,
  ChevronRightFilled,
} from "@fluentui/react-icons";

interface ScheduleConfig {
  enabled: boolean;
  cadence: string; // "hourly" | "daily" | "weekly"
  time: string; // "09:00"
  days_of_week: string[]; // ["MON", "TUE", ...]
  interval: number; // 1
  start_date: string | null; // "2026-02-09" or null
  end_date: string | null; // "2026-12-31" or null
}

interface ScriptDef {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  working_dir: string | null;
  schedule: ScheduleConfig | null;
}

interface ScriptResult {
  id: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

interface TaskStatus {
  exists: boolean;
  status: string;
  next_run: string;
  last_run: string;
  last_result: string;
}

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_LETTERS: Record<string, string> = {
  MON: "M",
  TUE: "T",
  WED: "W",
  THU: "T",
  FRI: "F",
  SAT: "S",
  SUN: "S",
};
const DAY_LABELS: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function defaultSchedule(): ScheduleConfig {
  return {
    enabled: true,
    cadence: "weekly",
    time: "09:00",
    days_of_week: ["MON"],
    interval: 1,
    start_date: todayISO(),
    end_date: null,
  };
}

function scheduleLabel(schedule: ScheduleConfig | null): string {
  if (!schedule) return "Not scheduled";
  if (!schedule.enabled) return "Schedule disabled";
  if (schedule.cadence === "hourly") {
    const interval =
      schedule.interval > 1 ? `Every ${schedule.interval} hours` : "Hourly";
    return `${interval} starting at ${schedule.time}`;
  }
  if (schedule.cadence === "daily") {
    const interval =
      schedule.interval > 1 ? `Every ${schedule.interval} days` : "Daily";
    return `${interval} at ${schedule.time}`;
  }
  if (schedule.cadence === "weekly") {
    const days = schedule.days_of_week
      .map((d) => DAY_LABELS[d] || d)
      .join(", ");
    const interval =
      schedule.interval > 1
        ? `Every ${schedule.interval} weeks`
        : "Weekly";
    return `${interval} (${days}) at ${schedule.time}`;
  }
  return "Scheduled";
}

export default function ScriptsTab() {
  const [scripts, setScripts] = useState<ScriptDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Map<string, ScriptResult>>(new Map());
  const [taskStatuses, setTaskStatuses] = useState<Map<string, TaskStatus>>(
    new Map()
  );
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScriptDef | null>(null);
  const [expandedSchedules, setExpandedSchedules] = useState<Set<string>>(
    new Set()
  );
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
      // Fetch task statuses for scripts with schedules
      for (const s of data) {
        if (s.schedule) fetchTaskStatus(s.id);
      }
    } catch (err) {
      console.error("Failed to load scripts:", err);
    }
    setLoading(false);
  }

  async function fetchTaskStatus(scriptId: string) {
    try {
      const status = await invoke<TaskStatus>("get_task_status", {
        scriptId,
      });
      setTaskStatuses((prev) => new Map(prev).set(scriptId, status));
    } catch {
      // ignore
    }
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

  async function deleteScript(id: string) {
    // Also remove any scheduled task
    try {
      await invoke("delete_scheduled_task", { scriptId: id });
    } catch {
      // ignore if no task exists
    }
    setScripts(scripts.filter((s) => s.id !== id));
  }

  function toggleScheduleExpand(id: string) {
    setExpandedSchedules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateScriptSchedule(
    scriptId: string,
    schedule: ScheduleConfig | null
  ) {
    setScripts((prev) =>
      prev.map((s) => (s.id === scriptId ? { ...s, schedule } : s))
    );
  }

  async function syncSchedule(script: ScriptDef) {
    try {
      const result = await invoke<string>("sync_scheduled_task", { script });
      setStatusMsg(result);
      // Save scripts after syncing
      const configDir = getConfigDir();
      await invoke("save_scripts", { configDir, scripts });
      // Refresh status
      fetchTaskStatus(script.id);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function removeSchedule(scriptId: string) {
    updateScriptSchedule(scriptId, null);
    try {
      await invoke("delete_scheduled_task", { scriptId });
      setStatusMsg("Schedule removed");
      setTaskStatuses((prev) => {
        const next = new Map(prev);
        next.delete(scriptId);
        return next;
      });
      // Save
      const configDir = getConfigDir();
      const updatedScripts = scripts.map((s) =>
        s.id === scriptId ? { ...s, schedule: null } : s
      );
      await invoke("save_scripts", { configDir, scripts: updatedScripts });
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function toggleScheduleEnabled(script: ScriptDef) {
    const current = script.schedule || defaultSchedule();
    const updated = { ...current, enabled: !current.enabled };
    const updatedScript = { ...script, schedule: updated };
    updateScriptSchedule(script.id, updated);
    await syncSchedule(updatedScript);
  }

  function getConfigDir(): string {
    return (
      (typeof window !== "undefined" &&
        localStorage.getItem("configDir")) ||
      `${getAppData()}/EdgeUtilities`
    );
  }

  function getAppData(): string {
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
                    args: data.value.split("\n").filter((a: string) => a.trim()),
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
          const scheduleExpanded = expandedSchedules.has(script.id);
          const taskStatus = taskStatuses.get(script.id);

          return (
            <div className="card" key={script.id}>
              <div className="card-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3>{script.name}</h3>
                  {script.schedule?.enabled && (
                    <span
                      title={scheduleLabel(script.schedule)}
                      style={{ color: "var(--accent)", fontSize: 14 }}
                    >
                      <CalendarClockFilled />
                    </span>
                  )}
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
                  marginBottom: 8,
                }}
              >
                $ {script.command} {script.args.join(" ")}
                {script.working_dir && (
                  <span style={{ marginLeft: 8 }}>
                    (in {script.working_dir})
                  </span>
                )}
              </div>

              {/* Schedule section */}
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  paddingTop: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                  onClick={() => toggleScheduleExpand(script.id)}
                >
                  <span style={{ fontSize: 10 }}>
                    {scheduleExpanded ? (
                      <ChevronDownFilled />
                    ) : (
                      <ChevronRightFilled />
                    )}
                  </span>
                  <CalendarClockFilled
                    style={{ fontSize: 14 }}
                  />
                  <span>{scheduleLabel(script.schedule)}</span>
                  {taskStatus?.exists && (
                    <span
                      className={`badge ${taskStatus.status === "Ready" ? "success" : taskStatus.status === "Disabled" ? "" : "warning"}`}
                      style={{ fontSize: 10, marginLeft: 4 }}
                    >
                      {taskStatus.status}
                    </span>
                  )}
                  {taskStatus?.next_run && taskStatus.status !== "Disabled" && (
                    <span style={{ fontSize: 10, opacity: 0.6 }}>
                      Next: {taskStatus.next_run}
                    </span>
                  )}
                </div>

                {scheduleExpanded && (
                  <ScheduleEditor
                    schedule={script.schedule}
                    taskStatus={taskStatus}
                    onChange={(s) => updateScriptSchedule(script.id, s)}
                    onSync={() =>
                      syncSchedule({
                        ...script,
                        schedule:
                          script.schedule ||
                          defaultSchedule(),
                      })
                    }
                    onRemove={() => removeSchedule(script.id)}
                    onToggle={() => toggleScheduleEnabled(script)}
                  />
                )}
              </div>

              {result && (
                <div style={{ marginTop: 8 }}>
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

function ScheduleEditor({
  schedule,
  taskStatus,
  onChange,
  onSync,
  onRemove,
  onToggle,
}: {
  schedule: ScheduleConfig | null;
  taskStatus: TaskStatus | undefined;
  onChange: (s: ScheduleConfig) => void;
  onSync: () => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  const config = schedule || defaultSchedule();

  function updateField<K extends keyof ScheduleConfig>(
    key: K,
    value: ScheduleConfig[K]
  ) {
    onChange({ ...config, [key]: value });
  }

  function toggleDay(day: string) {
    const current = config.days_of_week;
    if (current.includes(day)) {
      if (current.length > 1) {
        updateField(
          "days_of_week",
          current.filter((d) => d !== day)
        );
      }
    } else {
      updateField("days_of_week", [...current, day]);
    }
  }

  const cadenceUnit =
    config.cadence === "hourly"
      ? "hour"
      : config.cadence === "daily"
        ? "day"
        : "week";

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-tertiary, #2d2d2d)",
    color: "var(--text-primary)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 12,
    boxSizing: "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
  };

  const disabledStyle: React.CSSProperties = config.enabled
    ? {}
    : { opacity: 0.4, pointerEvents: "none" as const };

  return (
    <div
      style={{
        marginTop: 8,
        padding: 12,
        background: "rgba(255,255,255,0.03)",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* Row 1: Start date, Start time, Enabled toggle, Recurring badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={disabledStyle}>
          <span style={labelStyle}>Start date</span>
          <div style={{ marginTop: 2 }}>
            <input
              type="date"
              value={config.start_date || todayISO()}
              onChange={(e) =>
                updateField("start_date", e.target.value || null)
              }
              style={{ ...inputStyle, width: 140 }}
            />
          </div>
        </div>

        <div style={disabledStyle}>
          <span style={labelStyle}>Start time</span>
          <div style={{ marginTop: 2 }}>
            <input
              type="time"
              value={config.time}
              onChange={(e) => updateField("time", e.target.value)}
              style={{ ...inputStyle, width: 110 }}
            />
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Switch
            checked={config.enabled}
            onChange={() => onToggle()}
          />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 12px",
              borderRadius: 16,
              fontSize: 12,
              fontWeight: 600,
              background: config.enabled
                ? "rgba(0,120,212,0.15)"
                : "rgba(255,255,255,0.06)",
              color: config.enabled
                ? "var(--accent)"
                : "var(--text-secondary)",
              border: `1px solid ${config.enabled ? "var(--accent)" : "rgba(255,255,255,0.12)"}`,
            }}
          >
            <CalendarClockFilled style={{ fontSize: 14 }} />
            {config.enabled ? "Recurring" : "Disabled"}
          </span>
        </div>
      </div>

      {/* Row 2: Repeat every N [unit] + day circles + Until date */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          ...disabledStyle,
        }}
      >
        <span style={labelStyle}>Repeat every</span>
        <select
          value={String(config.interval)}
          onChange={(e) =>
            updateField("interval", Math.max(1, parseInt(e.target.value) || 1))
          }
          style={{ ...inputStyle, width: 52 }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <select
          value={config.cadence}
          onChange={(e) => updateField("cadence", e.target.value)}
          style={{ ...inputStyle, width: 80 }}
        >
          <option value="hourly">hour</option>
          <option value="daily">day</option>
          <option value="weekly">week</option>
        </select>

        {/* Day circles (shown for weekly and daily) */}
        {(config.cadence === "weekly") && (
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {DAYS.map((day) => {
              const selected = config.days_of_week.includes(day);
              return (
                <button
                  key={day}
                  title={DAY_LABELS[day]}
                  onClick={() => toggleDay(day)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: `2px solid ${selected ? "var(--accent)" : "rgba(255,255,255,0.2)"}`,
                    background: selected
                      ? "var(--accent)"
                      : "transparent",
                    color: selected ? "#fff" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    transition: "all 0.15s",
                  }}
                >
                  {DAY_LETTERS[day]}
                </button>
              );
            })}
          </div>
        )}

        <span style={{ ...labelStyle, marginLeft: 8 }}>Until</span>
        <input
          type="date"
          value={config.end_date || ""}
          onChange={(e) =>
            updateField("end_date", e.target.value || null)
          }
          style={{ ...inputStyle, width: 140 }}
        />
        {config.end_date && (
          <button
            onClick={() => updateField("end_date", null)}
            title="Remove end date"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
              padding: 2,
            }}
          >
            <DeleteFilled />
          </button>
        )}
      </div>

      {/* Hourly info note */}
      {config.cadence === "hourly" && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 8,
            fontStyle: "italic",
            ...disabledStyle,
          }}
        >
          Runs every {config.interval} {cadenceUnit}{config.interval > 1 ? "s" : ""} starting at {config.time}
        </div>
      )}

      {/* Task status info */}
      {taskStatus?.exists && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 12,
            padding: "6px 10px",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 4,
            fontFamily: "monospace",
          }}
        >
          <div>
            Status: <strong>{taskStatus.status}</strong>
          </div>
          {taskStatus.next_run && (
            <div>Next run: {taskStatus.next_run}</div>
          )}
          {taskStatus.last_run && (
            <div>Last run: {taskStatus.last_run}</div>
          )}
          {taskStatus.last_result && (
            <div>Last result: {taskStatus.last_result}</div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button appearance="primary" size="small" onClick={onSync}>
          Apply Schedule
        </Button>
        {schedule && (
          <Button
            appearance="subtle"
            size="small"
            onClick={onRemove}
            style={{ color: "#e74c3c" }}
          >
            Remove Schedule
          </Button>
        )}
      </div>
    </div>
  );
}
