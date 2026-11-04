// TypeR-UXP.ccx runs on every system, because clients up to 3.0.0 install it on
// any of them (updateLogic.js). It has no keyboard reader on Windows, where the
// reader is the native addon of UXP-Windows.ccx: there, it replaces itself with
// that package, bundled at the same version, as soon as its panel runs.
// Photoshop must restart. A failure is tried again at the next start.
import React from "react";
import config from "./config";
import { downloadAndInstallUpdate, getUpdateTestConfig, locale, nativeAlert } from "./utils";

export const useUxpPlatformPackage = () => {
  React.useEffect(() => {
    const host = typeof window !== "undefined" ? window.typerUXP : null;
    if (!host) return;
    const testConfig = getUpdateTestConfig();
    const testUrl = testConfig && testConfig.platformPackageUrl;
    (testUrl ? Promise.resolve(true) : host.request("needsPlatformPackage").catch(() => false)).then(async (needed) => {
      if (!needed) return;
      const complete = ({ reloading }) => {
        if (reloading) return;
        nativeAlert(locale.updateAutoInstalled.replace("{version}", config.appVersion), locale.successTitle, false);
      };
      const failed = (error) => {
        console.error("TypeR: Windows package", error);
        nativeAlert(locale.uxpWindowsPackageFailed, locale.errorTitle, true);
      };
      if (testUrl) {
        downloadAndInstallUpdate(testUrl, null, complete, failed, { expectedVersion: config.appVersion });
        return;
      }
      try {
        await host.flushStorage();
        await host.request("installBundledPlatformPackage");
        complete({ reloading: false });
      } catch (error) {
        failed(error);
      }
    });
  }, []);
};
