#!/usr/bin/env node
/**
 * 互動式安裝嚮導 — 引導用戶完成首次設定。
 * 用法：npm run setup 或 node scripts/setup.mjs
 */
import { createInterface } from 'node:readline';
import { writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function findVaults() {
  const home = homedir();
  const searchPaths = [join(home, 'Documents'), join(home, 'Desktop'), home];
  const vaults = [];
  for (const base of searchPaths) {
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const vaultPath = join(base, entry.name);
        if (existsSync(join(vaultPath, '.obsidian'))) vaults.push(vaultPath);
      }
    } catch { /* skip */ }
  }
  return vaults;
}

async function testToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    if (data.ok && data.result) return { ok: true, username: data.result.username };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function main() {
  console.log('\n🤖 ObsBot 安裝嚮導\n');
  console.log('此嚮導將引導你完成首次設定。\n');

  // Step 1: Check existing config
  if (existsSync(ENV_PATH)) {
    const overwrite = await ask('⚠️  .env 已存在，要覆蓋嗎？(y/N) ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('✅ 保留現有設定，結束。');
      rl.close();
      return;
    }
  }

  // Step 2: Bot Token
  console.log('\n📋 步驟 1/3：Telegram Bot Token');
  console.log('   從 @BotFather 取得 Bot Token：https://t.me/BotFather\n');
  let token = '';
  while (!token) {
    token = (await ask('   Bot Token: ')).trim();
    if (!token) {
      console.log('   ❌ Token 不能為空');
      continue;
    }
    console.log('   驗證中...');
    const result = await testToken(token);
    if (result.ok) {
      console.log(`   ✅ 驗證成功！Bot: @${result.username}`);
    } else {
      console.log('   ❌ Token 無效，請重新輸入');
      token = '';
    }
  }

  // Step 3: Vault Path
  console.log('\n📂 步驟 2/3：Obsidian Vault 路徑');
  const vaults = findVaults();
  let vaultPath = '';
  if (vaults.length > 0) {
    console.log('   偵測到以下 Vault：');
    vaults.forEach((v, i) => console.log(`   [${i + 1}] ${v}`));
    console.log(`   [${vaults.length + 1}] 手動輸入路徑`);
    const choice = await ask('\n   選擇 (1): ');
    const idx = parseInt(choice || '1', 10) - 1;
    if (idx >= 0 && idx < vaults.length) {
      vaultPath = vaults[idx];
    }
  }
  if (!vaultPath) {
    vaultPath = (await ask('   Vault 絕對路徑: ')).trim();
  }
  if (!vaultPath || !existsSync(vaultPath)) {
    console.log('   ⚠️  路徑不存在，請確認後手動修改 .env');
  }
  console.log(`   ✅ Vault: ${vaultPath}`);

  // Step 4: User ID (optional)
  console.log('\n🔐 步驟 3/3：存取控制（選填）');
  console.log('   輸入你的 Telegram User ID 限制存取（留空=所有人可用）');
  console.log('   可從 @userinfobot 取得你的 ID\n');
  const userIds = (await ask('   User ID (留空跳過): ')).trim();

  // Write .env
  const envLines = [
    `BOT_TOKEN=${token}`,
    `VAULT_PATH=${vaultPath}`,
  ];
  if (userIds) envLines.push(`ALLOWED_USER_IDS=${userIds}`);
  envLines.push('ENABLE_TRANSLATION=true');
  envLines.push('SAVE_VIDEOS=false');

  writeFileSync(ENV_PATH, envLines.join('\n') + '\n', 'utf-8');

  console.log('\n✅ 設定完成！.env 已寫入。');
  console.log('\n下一步：');
  console.log('  開發模式：npm run dev');
  console.log('  Docker：  docker compose up -d');
  console.log('  管理介面：http://localhost:3001\n');

  rl.close();
}

main().catch(err => {
  console.error('Setup error:', err);
  rl.close();
  process.exit(1);
});
