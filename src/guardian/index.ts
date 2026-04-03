import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger.js';
import { createGuardianApiServer } from './api.js';
import { getGuardianConfigPath, loadGuardianConfig } from './config.js';
import { installGuardianAgent } from './install-agent.js';
import { GuardianServiceManager } from './service.js';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  const config = loadGuardianConfig();
  const manager = new GuardianServiceManager(config);

  if (command === 'start') {
    manager.start();
    const server = createGuardianApiServer(manager, config.port);
    await server.start();
    logger.info('guardian', `Guardian console running at http://127.0.0.1:${config.port}`);
    return;
  }

  if (command === 'status') {
    process.stdout.write(JSON.stringify(manager.getSnapshot(), null, 2) + '\n');
    return;
  }

  if (command === 'check') {
    manager.start();
    setTimeout(() => {
      process.stdout.write(JSON.stringify(manager.getSnapshot(), null, 2) + '\n');
      manager.stop();
      process.exit(0);
    }, 1500);
    return;
  }

  if (command === 'install-agent') {
    const plistPath = installGuardianAgent(new URL('../../dist/guardian/index.js', import.meta.url).pathname);
    process.stdout.write(`Created ${plistPath}\n`);
    await execFileAsync('launchctl', ['load', plistPath]);
    process.stdout.write(`Loaded ${plistPath}\nConfig: ${getGuardianConfigPath()}\n`);
    return;
  }

  process.stderr.write('Unknown command. Use start | status | check | install-agent\n');
  process.exitCode = 1;
}

main().catch((error) => {
  logger.error('guardian', 'fatal error', error);
  process.exitCode = 1;
});
