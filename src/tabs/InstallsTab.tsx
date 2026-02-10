import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Spinner,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Select,
} from "@fluentui/react-components";
import {
  ArrowSyncFilled,
  DeleteFilled,
  ArrowDownloadFilled,
  FolderOpenFilled,
  RocketFilled,
  OpenFilled,
} from "@fluentui/react-icons";

interface EdgeInstall {
  channel: string;
  version: string;
  install_path: string;
  exe_path: string;
  is_system: boolean;
  installed: boolean;
  download_url: string;
}

interface MiniInstaller {
  filename: string;
  path: string;
  size_mb: number;
  modified: string;
}

export default function InstallsTab() {
  const [installs, setInstalls] = useState<EdgeInstall[]>([]);
  const [installers, setInstallers] = useState<MiniInstaller[]>([]);
  const [loading, setLoading] = useState(true);
  const [installChannel, setInstallChannel] = useState("stable");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [installsData, installersData] = await Promise.all([
        invoke<EdgeInstall[]>("get_edge_installs"),
        invoke<MiniInstaller[]>("find_mini_installers", { searchPath: null }),
      ]);
      setInstalls(installsData);
      setInstallers(installersData);
    } catch (err) {
      console.error("Failed to load installs:", err);
    }
    setLoading(false);
  }

  async function handleLaunch(exePath: string) {
    try {
      await invoke("launch_edge", { exePath, flags: [] });
      setStatusMsg("Edge launched");
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleOpenFolder(path: string) {
    try {
      await invoke("open_folder", { path });
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleOpenUrl(url: string) {
    try {
      await invoke("open_url", { url });
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleUninstall(exePath: string) {
    try {
      const result = await invoke<string>("uninstall_edge", { exePath });
      setStatusMsg(result);
      setTimeout(refresh, 3000);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  async function handleInstall(installerPath: string) {
    try {
      const result = await invoke<string>("install_edge", {
        installerPath,
        channel: installChannel,
      });
      setStatusMsg(result);
      setTimeout(refresh, 5000);
    } catch (err) {
      setStatusMsg(`Error: ${err}`);
    }
  }

  if (loading) {
    return (
      <div className="loading">
        <Spinner size="small" />
        <span>Detecting Edge installations...</span>
      </div>
    );
  }

  const installedBrowsers = installs.filter((i) => i.installed);
  const notInstalled = installs.filter((i) => !i.installed);

  return (
    <div>
      <div className="toolbar">
        <h2 className="section-title" style={{ flex: 1 }}>
          Installed Browsers
        </h2>
        <Button
          appearance="subtle"
          icon={<ArrowSyncFilled />}
          onClick={refresh}
        >
          Refresh
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

      <table className="data-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Version</th>
            <th>Type</th>
            <th>Path</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {installedBrowsers.map((install, i) => (
            <tr key={i}>
              <td>
                <span className={`badge ${install.channel.toLowerCase()}`}>
                  {install.channel}
                </span>
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                {install.version}
              </td>
              <td style={{ fontSize: 12 }}>
                {install.is_system ? "System" : "User"}
              </td>
              <td
                style={{
                  fontSize: 11,
                  maxWidth: 250,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={install.exe_path}
              >
                {install.install_path}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <Button
                  appearance="subtle"
                  icon={<RocketFilled />}
                  size="small"
                  onClick={() => handleLaunch(install.exe_path)}
                  title="Launch"
                />
                <Button
                  appearance="subtle"
                  icon={<FolderOpenFilled />}
                  size="small"
                  onClick={() => handleOpenFolder(install.install_path)}
                  title="Open folder"
                />
                <Dialog>
                  <DialogTrigger>
                    <Button
                      appearance="subtle"
                      icon={<DeleteFilled />}
                      size="small"
                      title="Uninstall"
                    />
                  </DialogTrigger>
                  <DialogSurface>
                    <DialogBody>
                      <DialogTitle>Confirm Uninstall</DialogTitle>
                      <DialogContent>
                        Uninstall Edge {install.channel} ({install.version})?
                      </DialogContent>
                      <DialogActions>
                        <DialogTrigger>
                          <Button appearance="secondary">Cancel</Button>
                        </DialogTrigger>
                        <Button
                          appearance="primary"
                          onClick={() => handleUninstall(install.exe_path)}
                        >
                          Uninstall
                        </Button>
                      </DialogActions>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              </td>
            </tr>
          ))}
          {notInstalled.map((install, i) => (
            <tr key={`not-${i}`} style={{ opacity: 0.6 }}>
              <td>
                <span className={`badge ${install.channel.toLowerCase()}`}>
                  {install.channel}
                </span>
              </td>
              <td
                style={{ fontSize: 12, color: "var(--text-secondary)" }}
                colSpan={2}
              >
                Not installed
              </td>
              <td></td>
              <td>
                <Button
                  appearance="subtle"
                  icon={<OpenFilled />}
                  size="small"
                  onClick={() => handleOpenUrl(install.download_url)}
                >
                  Download
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title" style={{ marginTop: 24 }}>
        Mini Installers (Downloads)
      </h2>

      {installers.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <FolderOpenFilled />
          </div>
          <p>No mini_installer files found in Downloads folder</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Size</th>
              <th>Modified</th>
              <th>Channel</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {installers.map((installer, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {installer.filename}
                </td>
                <td>{installer.size_mb} MB</td>
                <td>{installer.modified}</td>
                <td>
                  <Select
                    size="small"
                    value={installChannel}
                    onChange={(_e, data) => setInstallChannel(data.value)}
                  >
                    <option value="stable">Stable</option>
                    <option value="beta">Beta</option>
                    <option value="dev">Dev</option>
                    <option value="canary">Canary</option>
                  </Select>
                </td>
                <td>
                  <Button
                    appearance="primary"
                    icon={<ArrowDownloadFilled />}
                    size="small"
                    onClick={() => handleInstall(installer.path)}
                  >
                    Install
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
