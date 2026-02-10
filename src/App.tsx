import {
  FluentProvider,
  webDarkTheme,
  TabList,
  Tab,
  SelectTabEvent,
  SelectTabData,
} from "@fluentui/react-components";
import {
  AppsFilled,
  TopSpeedFilled,
  RocketFilled,
  BranchForkFilled,
  ScriptFilled,
} from "@fluentui/react-icons";
import { useState } from "react";
import "./App.css";

import InstallsTab from "./tabs/InstallsTab";
import ProcessesTab from "./tabs/ProcessesTab";
import LauncherTab from "./tabs/LauncherTab";
import ReposTab from "./tabs/ReposTab";
import ScriptsTab from "./tabs/ScriptsTab";

type TabId = "installs" | "processes" | "launcher" | "repos" | "scripts";

function App() {
  const [selectedTab, setSelectedTab] = useState<TabId>("installs");

  const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
    setSelectedTab(data.value as TabId);
  };

  return (
    <FluentProvider theme={webDarkTheme}>
      <div className="app-container">
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <TabList
            selectedValue={selectedTab}
            onTabSelect={onTabSelect}
            size="medium"
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
