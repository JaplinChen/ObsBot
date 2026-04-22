/**
 * /skills — unified AI skill management via Telegram.
 * Import/export skills between Claude Code and Codex formats.
 */
import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../utils/config.js';
import { runCommandTask } from './command-runner.js';
import { formatErrorMessage } from '../core/errors.js';
import { listSkills, saveSkill, loadSkill, saveAllSkillsToVault } from '../skills/skill-store.js';
import { parseClaudeSkill, parseCodexInstructions, toClaudeSkillMd, toCodexInstructions } from '../skills/skill-converter.js';
import type { UnifiedSkill } from '../skills/skill-types.js';
import { startTyping, stopTyping } from '../utils/typing-indicator.js';
import { logger } from '../core/logger.js';

/** /skills — entry point with InlineKeyboard */
export async function handleSkillsCommand(ctx: Context, _config: AppConfig): Promise<void> {
  const skills = await listSkills();

  const lines = ['🧩 AI 技能管理', ''];
  if (skills.length === 0) {
    lines.push('尚無匯入技能。使用下方按鈕匯入。');
  } else {
    // Group by category
    const byCategory = new Map<string, typeof skills>();
    for (const s of skills) {
      if (!byCategory.has(s.category)) byCategory.set(s.category, []);
      byCategory.get(s.category)!.push(s);
    }
    for (const [cat, catSkills] of [...byCategory.entries()].sort()) {
      lines.push(`📁 ${cat}（${catSkills.length}）`);
      for (const s of catSkills.slice(0, 5)) {
        const targets = s.targets.join('+');
        lines.push(`  • ${s.title} [${targets}]`);
      }
      if (catSkills.length > 5) lines.push(`  ... 還有 ${catSkills.length - 5} 個`);
    }
    lines.push('', `共 ${skills.length} 個技能`);
  }

  await ctx.reply(lines.join('\n'), Markup.inlineKeyboard([
    [
      Markup.button.callback('📥 匯入 Claude', 'sk:import:claude'),
      Markup.button.callback('📥 匯入 Codex', 'sk:import:codex'),
    ],
    [
      Markup.button.callback('📤 匯出 Claude', 'sk:export:claude'),
      Markup.button.callback('📤 匯出 Codex', 'sk:export:codex'),
    ],
    [
      Markup.button.callback('💾 備份到 Vault', 'sk:vault'),
    ],
  ]));
}

/** sk:import:claude — import all .claude/skills/{id}/SKILL.md */
export async function handleSkillImportClaude(ctx: Context, config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  try {
    const skillsDir = join(process.cwd(), '.claude', 'skills');
    let dirs: string[];
    try {
      dirs = await readdir(skillsDir);
    } catch {
      await ctx.reply('未找到 .claude/skills/ 目錄');
      return;
    }

    let imported = 0;
    for (const dir of dirs) {
      const filePath = join(skillsDir, dir, 'SKILL.md');
      try {
        const content = await readFile(filePath, 'utf-8');
        const skill = parseClaudeSkill(content, dir);
        await saveSkill(skill);
        imported++;
      } catch { /* skip invalid */ }
    }

    await ctx.reply(`✅ 已匯入 ${imported} 個 Claude Code 技能`);
    logger.info('skills', `匯入 Claude 技能: ${imported} 個`);
  } finally {
    stopTyping(typing);
  }
}

/** sk:import:codex — import AGENTS.md */
export async function handleSkillImportCodex(ctx: Context, _config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  try {
    const agentsPath = join(process.cwd(), 'AGENTS.md');
    let content: string;
    try {
      content = await readFile(agentsPath, 'utf-8');
    } catch {
      await ctx.reply('未找到 AGENTS.md 檔案');
      return;
    }

    const skills = parseCodexInstructions(content);
    let imported = 0;
    for (const skill of skills) {
      await saveSkill(skill);
      imported++;
    }

    await ctx.reply(`✅ 已匯入 ${imported} 個 Codex 技能段落`);
    logger.info('skills', `匯入 Codex 技能: ${imported} 個`);
  } finally {
    stopTyping(typing);
  }
}

/** sk:export:claude — export all skills as Claude SKILL.md files */
export async function handleSkillExportClaude(ctx: Context, _config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  try {
    const skillEntries = await listSkills();
    const skillsDir = join(process.cwd(), '.claude', 'skills');
    let exported = 0;

    for (const entry of skillEntries) {
      const skill = await loadSkill(entry.id);
      if (!skill) continue;

      const { writeFile: wf, mkdir: mk } = await import('node:fs/promises');
      const dir = join(skillsDir, skill.id);
      await mk(dir, { recursive: true });
      await wf(join(dir, 'SKILL.md'), toClaudeSkillMd(skill), 'utf-8');
      exported++;
    }

    await ctx.reply(`✅ 已匯出 ${exported} 個技能到 .claude/skills/`);
  } finally {
    stopTyping(typing);
  }
}

/** sk:export:codex — export all skills to AGENTS.md */
export async function handleSkillExportCodex(ctx: Context, _config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  try {
    const skillEntries = await listSkills();
    const skills: UnifiedSkill[] = [];

    for (const entry of skillEntries) {
      const skill = await loadSkill(entry.id);
      if (skill) skills.push(skill);
    }

    const content = toCodexInstructions(skills);
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(join(process.cwd(), 'AGENTS.md'), content, 'utf-8');

    await ctx.reply(`✅ 已匯出 ${skills.length} 個技能到 AGENTS.md`);
  } finally {
    stopTyping(typing);
  }
}

/** sk:vault — save all skills to Vault as Obsidian notes */
export async function handleSkillVault(ctx: Context, config: AppConfig): Promise<void> {
  const typing = startTyping(ctx);
  try {
    const count = await saveAllSkillsToVault(config.vaultPath);
    await ctx.reply(`✅ 已備份 ${count} 個技能到 Vault/KnowPipe/Skills/`);
  } finally {
    stopTyping(typing);
  }
}

/** Register sk:* callback handlers (called from register-commands.ts) */
export function registerSkillCallbacks(bot: Telegraf, config: AppConfig): void {
  const handlers: Record<string, (c: Context, cfg: AppConfig) => Promise<void>> = {
    'import:claude': handleSkillImportClaude,
    'import:codex': handleSkillImportCodex,
    'export:claude': handleSkillExportClaude,
    'export:codex': handleSkillExportCodex,
    vault: handleSkillVault,
  };

  bot.action(/^sk:(.+)$/, (ctx) => {
    const mode = (ctx as Context & { match: RegExpExecArray }).match![1];
    ctx.answerCbQuery().catch(() => {});
    const handler = handlers[mode];
    if (handler) {
      runCommandTask(ctx, 'skill-action', () => handler(ctx, config), formatErrorMessage).catch(() => {});
    }
  });
}
