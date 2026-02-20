import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Spinner,
  Input,
  Select,
  Switch,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Tooltip,
} from "@fluentui/react-components";
import {
  RocketFilled,
  AddFilled,
  DeleteFilled,
  ArrowSyncFilled,
  SaveFilled,
  FolderAddFilled,
  QuestionCircleFilled,
} from "@fluentui/react-icons";
import StatusBar from "../components/StatusBar";

const STORAGE_KEY_REMOTE_DEBUG = "edge-utils-launcher-remote-debug";

interface EdgeInstall {
  channel: string;
  version: string;
  install_path: string;
  exe_path: string;
  is_system: boolean;
  installed: boolean;
  download_url: string;
}

interface LaunchPreset {
  name: string;
  flags: string[];
}

interface RepoBuild {
  repo_path: string;
  out_dir: string;
  exe_path: string;
  last_modified: string;
}

export default function LauncherTab() {
  const [installs, setInstalls] = useState<EdgeInstall[]>([]);
  const [repoBuilds, setRepoBuilds] = useState<RepoBuild[]>([]);
  const [selectedExe, setSelectedExe] = useState("");
  const [commonPresets, setCommonPresets] = useState<LaunchPreset[]>([]);
  const [savedPresets, setSavedPresets] = useState<LaunchPreset[]>([]);
  const [activeFlags, setActiveFlags] = useState<string[]>([]);
  const [customFlag, setCustomFlag] = useState("");
  const [enableFeatures, setEnableFeatures] = useState("");
  const [disableFeatures, setDisableFeatures] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("");
  const [savePresetName, setSavePresetName] = useState("");
  const [remoteDebugging, setRemoteDebugging] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_REMOTE_DEBUG);
      return stored === null ? true : stored === "true";
    } catch { return true; }
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [installsData, presetsData] = await Promise.all([
        invoke<EdgeInstall[]>("get_edge_installs"),
        invoke<LaunchPreset[]>("get_common_flags"),
      ]);

      // Load repo list from config, then scan for msedge.exe builds
      const configDir = await getConfigDir();
      const repoPaths = await invoke<string[]>("load_repo_list", { configDir }).catch(() => []);
      const repoBuildsData = await invoke<RepoBuild[]>("get_repo_builds", { repoPaths }).catch(() => []);
      setInstalls(installsData.filter((i) => i.installed));
      setCommonPresets(presetsData);
      setRepoBuilds(repoBuildsData);
      if (installsData.filter((i) => i.installed).length > 0) {
        setSelectedExe(installsData.filter((i) => i.installed)[0].exe_path);
      }

      // Load saved presets
      const saved = await invoke<LaunchPreset[]>("load_presets", { configDir }).catch(() => []);
      setSavedPresets(saved);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
    setLoading(false);
  }

  async function getConfigDir(): Promise<string> {
    const appData = "C:\\EdgeUtilities";
    return appData;
  }

  function togglePreset(preset: LaunchPreset) {
    const alreadySelected = preset.flags.every((f) => activeFlags.includes(f));
    if (alreadySelected) {
      setActiveFlags(activeFlags.filter((f) => !preset.flags.includes(f)));
    } else {
      setActiveFlags([...activeFlags, ...preset.flags.filter((f) => !activeFlags.includes(f))]);
    }
  }

  function addCustomFlag() {
    if (customFlag.trim() && !activeFlags.includes(customFlag.trim())) {
      setActiveFlags([...activeFlags, customFlag.trim()]);
      setCustomFlag("");
    }
  }

  function removeFlag(flag: string) {
    setActiveFlags(activeFlags.filter((f) => f !== flag));
  }

  async function handleCreateTempProfile() {
    try {
      const dir = await invoke<string>("create_temp_user_data_dir");
      setActiveFlags([...activeFlags, `--user-data-dir=${dir}`]);
      setStatusMsg(`Created temp profile: ${dir}`);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleSavePreset() {
    if (!savePresetName.trim()) return;
    const allFlags = buildFinalFlags();
    const newPreset: LaunchPreset = { name: savePresetName.trim(), flags: allFlags };
    const updated = [...savedPresets, newPreset];
    setSavedPresets(updated);
    setSavePresetName("");

    try {
      const configDir = await getConfigDir();
      await invoke("save_presets", { configDir, presets: updated });
      setStatusMsg(`Preset "${newPreset.name}" saved`);
    } catch (err) {
      setStatusMsg(`Error saving: ${err}`);
    }
  }

  async function handleDeleteSavedPreset(index: number) {
    const updated = savedPresets.filter((_, i) => i !== index);
    setSavedPresets(updated);
    try {
      const configDir = await getConfigDir();
      await invoke("save_presets", { configDir, presets: updated });
    } catch (_) {
      // ignore save error
    }
  }

  function buildFinalFlags(): string[] {
    const flags = [...activeFlags];
    // Auto-add remote debugging port if enabled and not already present
    if (remoteDebugging && !flags.some((f) => f.startsWith("--remote-debugging-port="))) {
      flags.push("--remote-debugging-port=9222");
    }
    if (enableFeatures.trim()) {
      flags.push(`--enable-features=${enableFeatures.trim()}`);
    }
    if (disableFeatures.trim()) {
      flags.push(`--disable-features=${disableFeatures.trim()}`);
    }
    return flags;
  }

  async function launch() {
    if (!selectedExe) {
      setStatusMsg("Please select an Edge install");
      return;
    }
    try {
      const flags = buildFinalFlags();
      const result = await invoke<string>("launch_edge", {
        exePath: selectedExe,
        flags,
      });
      setStatusMsg(result);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <Spinner size="small" />
        <span>Loading launcher...</span>
      </div>
    );
  }

  const allTargets = [
    ...installs.map((i) => ({
      label: `${i.channel} (${i.version})`,
      value: i.exe_path,
    })),
    ...repoBuilds.map((b) => ({
      label: `Build: ${b.repo_path}\\out\\${b.out_dir} (${b.last_modified})`,
      value: b.exe_path,
    })),
  ];

  const finalFlags = buildFinalFlags();

  return (
    <div>
      <h2 className="section-title">Launch Edge</h2>

      <StatusBar message={statusMsg} tab="Launcher" onDismiss={() => setStatusMsg("")} />

      {/* Target Browser */}
      <div className="card">
        <div className="card-header">
          <h3>Target Browser</h3>
          <Button
            appearance="subtle"
            icon={<ArrowSyncFilled />}
            size="small"
            onClick={loadData}
          >
            Refresh
          </Button>
        </div>
        {allTargets.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>No Edge installations or builds found.</p>
        ) : (
          <Select
            value={selectedExe}
            onChange={(_e, data) => setSelectedExe(data.value)}
          >
            {allTargets.map((t, i) => (
              <option key={i} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {/* Quick Presets */}
      <div className="card">
        <div className="card-header">
          <h3>Quick Presets</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Switch
              checked={remoteDebugging}
              onChange={(_e, data) => {
                setRemoteDebugging(data.checked);
                localStorage.setItem(STORAGE_KEY_REMOTE_DEBUG, String(data.checked));
              }}
              label="Remote Debugging (CDP)"
              style={{ fontSize: 11 }}
            />
            <Tooltip
              content="Launches Edge with --remote-debugging-port=9222. Required for the Processes tab to discover and display open tab URLs."
              relationship="description"
              positioning="below"
            >
              <QuestionCircleFilled style={{ fontSize: 14, color: "#888", cursor: "help" }} />
            </Tooltip>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {commonPresets.map((preset, i) => {
            const isActive = preset.flags.every((f) => activeFlags.includes(f));
            return (
              <div
                key={i}
                className={`flag-chip ${isActive ? "selected" : ""}`}
                onClick={() => togglePreset(preset)}
              >
                {preset.name}
              </div>
            );
          })}
          <div
            className="flag-chip"
            onClick={handleCreateTempProfile}
            title="Create a random temp profile directory"
          >
            <FolderAddFilled style={{ fontSize: 14 }} />
            Temp Profile
          </div>
        </div>
      </div>

      {/* Saved Presets */}
      {savedPresets.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>Saved Presets</h3>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {savedPresets.map((preset, i) => {
              const isActive = preset.flags.every((f) => activeFlags.includes(f) || enableFeatures.includes(f) || disableFeatures.includes(f));
              return (
                <div
                  key={i}
                  className={`flag-chip ${isActive ? "selected" : ""}`}
                  style={{ position: "relative" }}
                >
                  <span onClick={() => {
                    // Apply all flags from preset
                    const newFlags = preset.flags.filter((f) => !f.startsWith("--enable-features=") && !f.startsWith("--disable-features="));
                    const ef = preset.flags.find((f) => f.startsWith("--enable-features="));
                    const df = preset.flags.find((f) => f.startsWith("--disable-features="));
                    setActiveFlags([...new Set([...activeFlags, ...newFlags])]);
                    if (ef) setEnableFeatures(ef.replace("--enable-features=", ""));
                    if (df) setDisableFeatures(df.replace("--disable-features=", ""));
                  }}>
                    {preset.name}
                  </span>
                  <span className="remove" onClick={() => handleDeleteSavedPreset(i)}>
                    &times;
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Feature Flags */}
      <div className="card">
        <div className="card-header">
          <h3>Feature Flags</h3>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
              Enable Features (comma-separated)
            </label>
            <Input
              placeholder="FeatureA,FeatureB"
              value={enableFeatures}
              onChange={(_e, data) => setEnableFeatures(data.value)}
              size="small"
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4, display: "block" }}>
              Disable Features (comma-separated)
            </label>
            <Input
              placeholder="FeatureC,FeatureD"
              value={disableFeatures}
              onChange={(_e, data) => setDisableFeatures(data.value)}
              size="small"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      {/* Active Flags */}
      <div className="card">
        <div className="card-header">
          <h3>Active Flags</h3>
        </div>

        {activeFlags.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            No flags selected. Click presets above or add custom flags below.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {activeFlags.map((flag, i) => (
              <div key={i} className="flag-chip selected">
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>{flag}</span>
                <span className="remove" onClick={() => removeFlag(flag)}>
                  &times;
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Input
            placeholder="--custom-flag=value"
            value={customFlag}
            onChange={(_e, data) => setCustomFlag(data.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCustomFlag();
            }}
            style={{ flex: 1 }}
            size="small"
          />
          <Button
            appearance="subtle"
            icon={<AddFilled />}
            size="small"
            onClick={addCustomFlag}
          >
            Add
          </Button>
          <Button
            appearance="subtle"
            icon={<DeleteFilled />}
            size="small"
            onClick={() => { setActiveFlags([]); setEnableFeatures(""); setDisableFeatures(""); }}
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Launch + Save */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <Button
          appearance="primary"
          icon={<RocketFilled />}
          size="large"
          onClick={launch}
          disabled={!selectedExe}
        >
          Launch Edge
        </Button>
        <Dialog>
          <DialogTrigger>
            <Button
              appearance="subtle"
              icon={<SaveFilled />}
              size="small"
              disabled={finalFlags.length === 0}
            >
              Save as Preset
            </Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Save Preset</DialogTitle>
              <DialogContent>
                <Input
                  placeholder="Preset name"
                  value={savePresetName}
                  onChange={(_e, data) => setSavePresetName(data.value)}
                  style={{ width: "100%", marginTop: 8 }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSavePreset(); }}
                />
                <div style={{ marginTop: 8, fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)" }}>
                  {finalFlags.join(" ")}
                </div>
              </DialogContent>
              <DialogActions>
                <DialogTrigger>
                  <Button appearance="secondary">Cancel</Button>
                </DialogTrigger>
                <Button appearance="primary" onClick={handleSavePreset} disabled={!savePresetName.trim()}>
                  Save
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>

      {finalFlags.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            fontFamily: "monospace",
            color: "var(--text-secondary)",
            wordBreak: "break-all",
          }}
        >
          {selectedExe} {finalFlags.join(" ")}
        </div>
      )}
    </div>
  );
}
