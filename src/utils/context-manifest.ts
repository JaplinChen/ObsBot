/**
 * Context manifest — scans the codebase to generate project metadata.
 * Used by sync-context script to auto-update CLAUDE.md,
 * and exportable as system prompts for other AI tools.
 */
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { getUserConfig } from './user-config.js';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ProjectManifest {
  name: string;
  description: string;
  techStack: string[];
  extractors: { count: number; platforms: string[] };
  commands: { count: number; names: string[] };
  features: Record<string, boolean>;
  pipeline: string[];
  conventions: string[];
  recentChanges: string[];
  generatedAt: string;
}

/* ── Scanning functions ───────────────────────────────────────────── */

const SRC_ROOT = join(process.cwd(), 'src');

async function scanExtractorPlatforms(): Promise<string[]> {
  try {
    const files = await readdir(join(SRC_ROOT, 'extractors'));
    return files
      .filter(f => f.endsWith('-extractor.ts') && !f.endsWith('.test.ts'))
      .map(f => f.replace('-extractor.ts', ''))
      .sort();
  } catch {
    return [];
  }
}

async function scanCommandNames(): Promise<string[]> {
  try {
    const files = await readdir(join(SRC_ROOT, 'commands'));
    return files
      .filter(f => f.endsWith('-command.ts') && !f.endsWith('.test.ts'))
      .map(f => f.replace('-command.ts', ''))
      .sort();
  } catch {
    return [];
  }
}

function readFeatureFlags(): Record<string, boolean> {
  try {
    const cfg = getUserConfig();
    return { ...cfg.features };
  } catch {
    return {};
  }
}

function getRecentGitChanges(count = 10): string[] {
  try {
    const out = execSync(`git log --oneline -${count} --since='14 days ago'`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 5_000,
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/* ── Manifest builder ─────────────────────────────────────────────── */

let _cache: { manifest: ProjectManifest; expiry: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getManifest(): Promise<ProjectManifest> {
  const now = Date.now();
  if (_cache && now < _cache.expiry) return _cache.manifest;

  const [platforms, commands] = await Promise.all([
    scanExtractorPlatforms(),
    scanCommandNames(),
  ]);

  const manifest: ProjectManifest = {
    name: 'KnowPipe',
    description: 'Telegram Bot：從 URL 提取內容，經 AI 豐富化後存入 Obsidian Vault',
    techStack: ['TypeScript', 'Telegraf', 'oMLX (local LLM)', 'Node.js', 'macOS'],
    extractors: { count: platforms.length, platforms },
    commands: { count: commands.length, names: commands },
    features: readFeatureFlags(),
    pipeline: ['extractor', 'classifier', 'enricher', 'reviewer', 'saver'],
    conventions: [
      '禁用 API SDK，LLM 走 oMLX REST 或外部 CLI',
      '檔案 ≤ 300 行',
      '純型別用 import type',
      'Commit message 格式：<type>: <繁體中文描述>',
      '新功能整合進現有 pipeline，不另建獨立 command',
    ],
    recentChanges: getRecentGitChanges(),
    generatedAt: new Date().toISOString(),
  };

  _cache = { manifest, expiry: now + CACHE_TTL_MS };
  return manifest;
}

/* ── Export formatters ────────────────────────────────────────────── */

export function toCLAUDE(manifest: ProjectManifest): string {
  const lines: string[] = [
    `## 專案即時狀態（自動同步）`,
    '',
    `> 上次同步：${manifest.generatedAt.slice(0, 19).replace('T', ' ')}`,
    '',
    `### 提取器（${manifest.extractors.count} 個平台）`,
    manifest.extractors.platforms.join(', '),
    '',
    `### 指令（${manifest.commands.count} 個）`,
    manifest.commands.names.join(', '),
    '',
    `### 處理管線`,
    manifest.pipeline.join(' → '),
    '',
    `### 功能開關`,
    '| 功能 | 狀態 |',
    '|------|------|',
  ];

  for (const [key, val] of Object.entries(manifest.features)) {
    lines.push(`| ${key} | ${val ? '啟用' : '停用'} |`);
  }

  if (manifest.recentChanges.length > 0) {
    lines.push('', `### 近期變更（最近 14 天）`);
    for (const c of manifest.recentChanges.slice(0, 8)) {
      lines.push(`- ${c}`);
    }
  }

  return lines.join('\n');
}

export function toSystemPrompt(manifest: ProjectManifest): string {
  return [
    `Project: ${manifest.name} — ${manifest.description}`,
    `Stack: ${manifest.techStack.join(', ')}`,
    `Platforms: ${manifest.extractors.count} extractors (${manifest.extractors.platforms.slice(0, 8).join(', ')}${manifest.extractors.count > 8 ? '…' : ''})`,
    `Pipeline: ${manifest.pipeline.join(' → ')}`,
    `Commands: ${manifest.commands.count} (${manifest.commands.names.slice(0, 6).join(', ')}…)`,
    `Rules: ${manifest.conventions.slice(0, 3).join('; ')}`,
  ].join('\n');
}

export function toCursorRules(manifest: ProjectManifest): string {
  const lines = [
    `# ${manifest.name} — Cursor Rules`,
    '',
    `## 專案描述`,
    manifest.description,
    '',
    `## 技術棧`,
    manifest.techStack.join(', '),
    '',
    `## 架構`,
    `處理管線：${manifest.pipeline.join(' → ')}`,
    `提取器：${manifest.extractors.platforms.join(', ')}`,
    '',
    `## 開發規範`,
  ];

  for (const c of manifest.conventions) {
    lines.push(`- ${c}`);
  }

  lines.push(
    '',
    `## 檔案結構`,
    `- src/extractors/ — 平台提取器（${manifest.extractors.count} 個）`,
    `- src/commands/ — Telegram 指令（${manifest.commands.count} 個）`,
    `- src/messages/services/ — 管線服務（extract, enrich, review, save）`,
    `- src/formatters/ — Obsidian 筆記格式化器`,
    `- src/admin/ — Admin UI`,
    `- src/utils/ — 工具函式（omlx-client, user-config 等）`,
  );

  return lines.join('\n');
}
