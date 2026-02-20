import { Button } from "@fluentui/react-components";
import { BugFilled } from "@fluentui/react-icons";
import { openUrl } from "@tauri-apps/plugin-opener";

const ISSUES_URL = "https://github.com/champnic/EdgeUtilities/issues/new";

function isErrorMessage(msg: string): boolean {
  return /^error|failed|scan failed/i.test(msg);
}

function buildIssueUrl(errorMsg: string, tab: string): string {
  const title = encodeURIComponent(`[${tab}] ${errorMsg.slice(0, 100)}`);
  const body = encodeURIComponent(
    `## Error\n\n\`\`\`\n${errorMsg}\n\`\`\`\n\n## Tab\n\n${tab}\n\n## Steps to Reproduce\n\n1. \n\n## Expected Behavior\n\n`
  );
  return `${ISSUES_URL}?title=${title}&body=${body}&labels=bug`;
}

interface StatusBarProps {
  message: string;
  tab: string;
  onDismiss: () => void;
  style?: React.CSSProperties;
}

export default function StatusBar({ message, tab, onDismiss, style }: StatusBarProps) {
  if (!message) return null;

  const isError = isErrorMessage(message);

  return (
    <div
      className="card"
      style={{
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        ...(isError ? { borderColor: "var(--danger, #f44336)" } : {}),
        ...style,
      }}
    >
      <span style={{ flex: 1, whiteSpace: "pre-wrap", fontSize: 12 }}>{message}</span>
      {isError && (
        <Button
          appearance="subtle"
          icon={<BugFilled />}
          size="small"
          onClick={() => openUrl(buildIssueUrl(message, tab))}
          title="Report this error as a GitHub issue"
        >
          Report
        </Button>
      )}
      <Button
        appearance="subtle"
        size="small"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
