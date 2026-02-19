import {
  FluentProvider,
  webDarkTheme,
  TabList,
  Tab,
  SelectTabEvent,
  SelectTabData,
  Button,
  Spinner,
} from "@fluentui/react-components";
import {
  AppsFilled,
  TopSpeedFilled,
  RocketFilled,
  BranchForkFilled,
  ScriptFilled,
  ArrowDownloadFilled,
} from "@fluentui/react-icons";
import { useState, useEffect } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";

import InstallsTab from "./tabs/InstallsTab";
import ProcessesTab from "./tabs/ProcessesTab";
import LauncherTab from "./tabs/LauncherTab";
import ReposTab from "./tabs/ReposTab";
import ScriptsTab from "./tabs/ScriptsTab";

type TabId = "installs" | "processes" | "launcher" | "repos" | "scripts";

function App() {
  const [selectedTab, setSelectedTab] = useState<TabId>("installs");
  const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [updating, setUpdating] = useState(false);

  const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
    setSelectedTab(data.value as TabId);
  };

  // Check for updates on launch
  useEffect(() => {
    check()
      .then((update) => {
        if (update) {
          setUpdateAvailable(update);
          setUpdateStatus(`v${update.version} available`);
        }
      })
      .catch(() => {}); // Silently fail if offline or no releases yet
  }, []);

  async function handleUpdate() {
    if (!updateAvailable) return;
    setUpdating(true);
    setUpdateStatus("Downloading...");
    try {
      await updateAvailable.downloadAndInstall();
      setUpdateStatus("Restarting...");
      await relaunch();
    } catch (e) {
      setUpdateStatus(`Update failed: ${e}`);
      setUpdating(false);
    }
  }

  return (
    <FluentProvider theme={webDarkTheme}>
      <div className="app-container">
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center" }}>
          <TabList
            selectedValue={selectedTab}
            onTabSelect={onTabSelect}
            size="medium"
            style={{ flex: 1 }}
          >
            <Tab value="installs" icon={<AppsFilled />}>
              Installs
            </Tab>
            <Tab value="processes" icon={<TopSpeedFilled />}>
              Processes
            </Tab>
            <Tab value="launcher" icon={<RocketFilled />}>
              Launcher
            </Tab>
            <Tab value="repos" icon={<BranchForkFilled />}>
              Repos
            </Tab>
            <Tab value="scripts" icon={<ScriptFilled />}>
              Scripts
            </Tab>
          </TabList>
          {updateAvailable && (
            <div style={{ paddingRight: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Button
                appearance="primary"
                icon={updating ? <Spinner size="tiny" /> : <ArrowDownloadFilled />}
                size="small"
                onClick={handleUpdate}
                disabled={updating}
              >
                {updateStatus}
              </Button>
            </div>
          )}
        </div>
        <div className="tab-content">
          {selectedTab === "installs" && <InstallsTab />}
          {selectedTab === "processes" && <ProcessesTab />}
          {selectedTab === "launcher" && <LauncherTab />}
          {selectedTab === "repos" && <ReposTab />}
          {selectedTab === "scripts" && <ScriptsTab />}
        </div>
      </div>
    </FluentProvider>
  );
}

export default App;
