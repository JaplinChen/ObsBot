/**
 * Skill format converter — bidirectional conversion between
 * Claude Code SKILL.md, Codex AGENTS.md, and UnifiedSkill format.
 */
import { createHash } from 'node:crypto';
import type { UnifiedSkill, SkillTarget, SkillMetadata } from './skill-types.js';

/* ── Helpers ──────────────────────────────────────────────── */

function contentHash(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Parse YAML frontmatter from markdown (simple key: value only). */
function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: md };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: match[2] };
}

/** Extract sections from markdown body by ## headings. */
function extractSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = body.split(/^##\s+/m);

  for (const part of parts) {
    if (!part.trim()) continue;
    const newline = part.indexOf('\n');
    if (newline === -1) continue;
    const heading = part.slice(0, newline).trim();
    const content = part.slice(newline + 1).trim();
    sections.set(heading, content);
  }
  return sections;
}

/* ── Import: Claude Code SKILL.md → UnifiedSkill ──────────── */

export function parseClaudeSkill(skillMd: string, skillId: string): UnifiedSkill {
  const { meta, body } = parseFrontmatter(skillMd);
  const sections = extractSections(body);

  // Extract triggers from description or usage section
  const triggers: string[] = [];
  if (meta.description) {
    const triggerMatch = meta.description.match(/\/\w+/g);
    if (triggerMatch) triggers.push(...triggerMatch);
  }

  // Extract constraints from "核心規則" or "規則" sections
  const constraints: string[] = [];
  for (const [heading, content] of sections) {
    if (heading.includes('規則') || heading.includes('constraint') || heading.includes('rule')) {
      const items = content.match(/^[-*]\s+(.+)$/gm);
      if (items) constraints.push(...items.map(i => i.replace(/^[-*]\s+/, '')));
    }
  }

  // Extract examples from code blocks
  const examples: string[] = [];
  const codeBlocks = body.match(/```[\s\S]*?```/g);
  if (codeBlocks) {
    for (const block of codeBlocks.slice(0, 3)) {
      examples.push(block);
    }
  }

  return {
    id: skillId,
    title: meta.title ?? skillId,
    description: meta.description ?? '',
    triggers,
    instructions: body,
    constraints,
    examples,
    category: guessCategory(meta.title ?? skillId, body),
    sourceFormat: 'claude',
    metadata: {
      author: 'knowpipe',
      version: '1.0.0',
      tags: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      contentHash: contentHash(body),
    },
  };
}

/* ── Import: Codex AGENTS.md → UnifiedSkill[] ─────────────── */

export function parseCodexInstructions(agentsMd: string): UnifiedSkill[] {
  const { body } = parseFrontmatter(agentsMd);
  const skills: UnifiedSkill[] = [];

  // Split by top-level ## sections, each becomes a skill
  const parts = body.split(/^##\s+/m).filter(p => p.trim());

  for (const part of parts) {
    const newline = part.indexOf('\n');
    if (newline === -1) continue;

    const heading = part.slice(0, newline).trim();
    const content = part.slice(newline + 1).trim();
    if (!content || content.length < 20) continue;

    const id = slugify(heading);
    skills.push({
      id: `codex-${id}`,
      title: heading,
      description: content.split('\n')[0].slice(0, 120),
      triggers: [],
      instructions: content,
      constraints: [],
      examples: [],
      category: guessCategory(heading, content),
      sourceFormat: 'codex',
      metadata: {
        author: 'knowpipe',
        version: '1.0.0',
        tags: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
        contentHash: contentHash(content),
      },
    });
  }

  return skills;
}

/* ── Export: UnifiedSkill → Claude Code SKILL.md ──────────── */

export function toClaudeSkillMd(skill: UnifiedSkill): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${skill.title}`);
  lines.push(`description: ${skill.description}`);
  lines.push('---');
  lines.push('');
  lines.push(skill.instructions);

  return lines.join('\n');
}

/* ── Export: UnifiedSkill[] → Codex AGENTS.md ─────────────── */

export function toCodexInstructions(skills: UnifiedSkill[]): string {
  const lines: string[] = ['# AGENTS.md', ''];

  for (const skill of skills) {
    lines.push(`## ${skill.title}`, '');
    lines.push(skill.instructions);
    lines.push('');
  }

  return lines.join('\n');
}

/* ── Export: UnifiedSkill → Vault Markdown ────────────────── */

export function toVaultSkillNote(skill: UnifiedSkill): string {
  const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const tags = ['skill', skill.sourceFormat, ...skill.metadata.tags].map(t => `"${t}"`).join(', ');

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: "技能：${skill.title}"`);
  lines.push(`date: ${now}`);
  lines.push(`tags: [${tags}]`);
  lines.push(`skill_id: ${skill.id}`);
  lines.push(`source_format: ${skill.sourceFormat}`);
  lines.push(`category: ${skill.category}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${skill.title}`, '');
  lines.push(`> ${skill.description}`, '');

  if (skill.triggers.length > 0) {
    lines.push('## 觸發條件', '');
    for (const t of skill.triggers) lines.push(`- ${t}`);
    lines.push('');
  }

  lines.push('## 指令內容', '');
  lines.push(skill.instructions);
  lines.push('');

  if (skill.constraints.length > 0) {
    lines.push('## 約束條件', '');
    for (const c of skill.constraints) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*匯入自 ${skill.sourceFormat} | ${skill.metadata.updatedAt.slice(0, 10)}*`);

  return lines.join('\n');
}

/* ── Category guesser ─────────────────────────────────────── */

function guessCategory(title: string, body: string): string {
  const text = `${title} ${body}`.toLowerCase();

  if (/test|測試|smoke|classify|assert/.test(text)) return 'testing';
  if (/deploy|ship|push|release|ci|cd/.test(text)) return 'deployment';
  if (/refactor|重構|cleanup|lint/.test(text)) return 'code-quality';
  if (/design|設計|ui|ux|css/.test(text)) return 'design';
  if (/health|健康|status|monitor/.test(text)) return 'monitoring';
  if (/vault|obsidian|知識|knowledge/.test(text)) return 'knowledge';
  if (/dev|開發|feature|功能/.test(text)) return 'development';
  return 'general';
}
