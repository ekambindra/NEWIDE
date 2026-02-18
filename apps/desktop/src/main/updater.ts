import { app } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export type ReleaseChannel = "stable" | "beta";

export type UpdateCheckResult = {
  skipped: boolean;
  channel: ReleaseChannel;
  reason: string | null;
  updateInfo: {
    version: string;
    files: number;
    releaseDate: string | null;
  } | null;
};

export function resolveReleaseChannel(input: string | undefined | null): ReleaseChannel {
  const normalized = (input ?? "").trim().toLowerCase();
  if (normalized === "beta") {
    return "beta";
  }
  return "stable";
}

export function configureAutoUpdater(channel: ReleaseChannel): void {
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
}

export async function checkForUpdates(channel: ReleaseChannel): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      skipped: true,
      channel,
      reason: "app is not packaged",
      updateInfo: null
    };
  }

  try {
    configureAutoUpdater(channel);
    const result = await autoUpdater.checkForUpdates();
    return {
      skipped: false,
      channel,
      reason: null,
      updateInfo: result?.updateInfo
        ? {
            version: result.updateInfo.version,
            files: result.updateInfo.files.length,
            releaseDate: result.updateInfo.releaseDate ?? null
          }
        : null
    };
  } catch (error) {
    return {
      skipped: true,
      channel,
      reason: error instanceof Error ? error.message : "update check failed",
      updateInfo: null
    };
  }
}
