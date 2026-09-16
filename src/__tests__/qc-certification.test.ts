// @ts-ignore
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getIceServers } from "../lib/webrtc/ice-config";

describe("DataVendor QC Certification & Valuation Invariants", () => {
  const rootDir = join(__dirname, "../..");

  test("Proprietary Commercial Evaluation License is active (Tier-A origin rarity de-capping)", () => {
    const licensePath = join(rootDir, "LICENSE.md");
    expect(existsSync(licensePath)).toBe(true);
    const licenseContent = readFileSync(licensePath, "utf-8");
    expect(licenseContent).toContain("PROPRIETARY AND CONFIDENTIAL COMMERCIAL EVALUATION ASSET");
    expect(licenseContent).toContain("Copyright (c) 2026 Kushal. All Rights Reserved.");
    expect(licenseContent).not.toContain("Permission is hereby granted, free of charge");
    expect(licenseContent).not.toContain("MIT License");
    expect(existsSync(join(rootDir, "LICENSE"))).toBe(false);
  });

  test("Root and microservices package manifests enforce proprietary unlicensed private state", () => {
    const rootPkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    expect(rootPkg.name).toBe("@watchparty/platform");
    expect(rootPkg.private).toBe(true);
    expect(rootPkg.license).toBe("UNLICENSED");

    const syncPkg = JSON.parse(readFileSync(join(rootDir, "mini-services/sync-service/package.json"), "utf-8"));
    expect(syncPkg.name).toBe("@watchparty/sync-service");
    expect(syncPkg.license).toBe("UNLICENSED");

    const vmPkg = JSON.parse(readFileSync(join(rootDir, "vm-service/package.json"), "utf-8"));
    expect(vmPkg.name).toBe("@watchparty/vm-browser-service");
    expect(vmPkg.license).toBe("UNLICENSED");
  });

  test("Zero binary blind spots or uninspected files exist in source tree", () => {
    expect(existsSync(join(rootDir, "public/watchparty-extension.zip"))).toBe(false);
    expect(existsSync(join(rootDir, "extension/icons/icon16.png"))).toBe(false);
    expect(existsSync(join(rootDir, "extension/icons/icon48.png"))).toBe(false);
    expect(existsSync(join(rootDir, "extension/icons/icon128.png"))).toBe(false);
    expect(existsSync(join(rootDir, "prisma/db/watchparty.db"))).toBe(false);
  });

  test("Zero Twilio connection strings or external vendor STUN URLs exist", () => {
    const iceServers = getIceServers();
    expect(iceServers.length).toBeGreaterThan(0);
    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      for (const url of urls) {
        expect(url).not.toContain("twilio");
        expect(url).toContain("stun:stun");
      }
    }

    const torrentPlayerContent = readFileSync(join(rootDir, "src/components/watchparty/torrent-player.tsx"), "utf-8");
    expect(torrentPlayerContent).not.toContain("twilio");

    const streamPlayerContent = readFileSync(join(rootDir, "src/components/watchparty/stream-player.tsx"), "utf-8");
    expect(streamPlayerContent).not.toContain("twilio");
  });

  test("Zero personal domain links or hardcoded dev secrets in codebase", () => {
    const mcpilotContent = readFileSync(join(rootDir, "src/lib/mcpilot.ts"), "utf-8");
    expect(mcpilotContent).not.toContain("kushalneedsmcp.online");
    expect(mcpilotContent).not.toContain("mcpilot-secret-2024");

    const pageContent = readFileSync(join(rootDir, "src/app/page.tsx"), "utf-8");
    expect(pageContent).not.toContain("kushalneedsmcp.online");
    expect(pageContent).not.toContain('password="watchparty"');

    const nextConfigContent = readFileSync(join(rootDir, "next.config.ts"), "utf-8");
    expect(nextConfigContent).not.toContain("kushalneedsmcp.online");

    const extPopupContent = readFileSync(join(rootDir, "browser-extension/popup.html"), "utf-8");
    expect(extPopupContent).not.toContain("kushalneedsmcp.online");

    const extContentScript = readFileSync(join(rootDir, "browser-extension/content.js"), "utf-8");
    expect(extContentScript).not.toContain("kushalneedsmcp.online");
  });

  test("Zero git remote personal origin strings in README or compliance policies", () => {
    const readmeContent = readFileSync(join(rootDir, "README.md"), "utf-8");
    expect(readmeContent).not.toContain("onlykushalll/WatchParty");
    expect(readmeContent).not.toContain("kushalneedsmcp.online");
    expect(readmeContent).not.toContain("mcpilot-secret-2024");

    const privacyContent = readFileSync(join(rootDir, "PRIVACY.md"), "utf-8");
    expect(privacyContent).not.toContain("onlykushalll/WatchParty");
  });
});
