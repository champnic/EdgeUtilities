import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Text,
  Link,
  Card,
  CardHeader,
} from "@fluentui/react-components";
import { BugFilled } from "@fluentui/react-icons";

const ISSUES_URL = "https://github.com/champnic/EdgeUtilities/issues";

export default function AboutTab() {
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <Text size={800} weight="bold" block style={{ marginBottom: 16 }}>
        Edge Utilities
      </Text>
      <Text size={400} block style={{ marginBottom: 24 }}>
        Version {version}
      </Text>

      <Card style={{ marginBottom: 16 }}>
        <CardHeader
          image={<BugFilled style={{ fontSize: 24 }} />}
          header={
            <Link
              onClick={(e) => {
                e.preventDefault();
                openUrl(ISSUES_URL);
              }}
            >
              Report an issue or request a feature
            </Link>
          }
          description="Opens the GitHub Issues page"
        />
      </Card>
    </div>
  );
}
