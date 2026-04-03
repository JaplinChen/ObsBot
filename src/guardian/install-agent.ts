import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LABEL = 'com.obsbot.guardian';

export function installGuardianAgent(entryFile: string): string {
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
  const plistPath = join(launchAgentsDir, `${LABEL}.plist`);
  mkdirSync(launchAgentsDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>
<string>/bin/zsh</string><string>-lc</string>
<string>cd "${process.cwd()}" && node "${entryFile}" start</string>
</array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${join(process.cwd(), 'data', 'guardian-agent.log')}</string>
<key>StandardErrorPath</key><string>${join(process.cwd(), 'data', 'guardian-agent.log')}</string>
</dict></plist>`;
  writeFileSync(plistPath, plist, 'utf-8');
  return plistPath;
}
