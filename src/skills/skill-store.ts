/**
 * Skill storage — persists unified skills to data/ directory
 * with JSON index and individual skill files.
 * Also provides Vault backup as Obsidian notes.
 */
import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import type { UnifiedSkill, SkillIndex, SkillIndexEntry, SkillTarget } from './skill-types.js';
import { toVaultSkillNote } from './skill-converter.js';
import { logger } from '../core/logger.js';

const INDEX_PATH = join(process.cwd(), 'data', 'skill-index.json');
const SKILLS_DIR = join(process.cwd(), 'data', 'skills');

function createEmptyIndex(): SkillIndex {
  return { version: 1, updatedAt: new Date().toISOString(), skills: [] };
}

/* ── Index operations ─────────────────────────────────────── */

export async function loadSkillIndex(): Promise<SkillIndex> {
  return safeReadJSON<SkillIndex>(INDEX_PATH, createEmptyIndex());
}

export async function saveSkillIndex(index: SkillIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await safeWriteJSON(INDEX_PATH, index);
}

/** Update or insert a skill entry in the index. */
function upsertIndexEntry(index: SkillIndex, skill: UnifiedSkill): void {
  const existing = index.skills.findIndex(s => s.id === skill.id);
  const entry: SkillIndexEntry = {
    id: skill.id,
    title: skill.title,
    category: skill.category,
    targets: [skill.sourceFormat],
    lastSyncAt: null,
  };

  if (existing >= 0) {
    // Merge targets
    const oldTargets = index.skills[existing].targets;
    entry.targets = [...new Set([...oldTargets, skill.sourceFormat])];
    entry.lastSyncAt = index.skills[existing].lastSyncAt;
    index.skills[existing] = entry;
  } else {
    index.skills.push(entry);
  }
}

/* ── Skill CRUD ───────────────────────────────────────────── */

export async function loadSkill(id: string): Promise<UnifiedSkill | null> {
  const filePath = join(SKILLS_DIR, `${id}.json`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as UnifiedSkill;
  } catch {
    return null;
  }
}

export async function saveSkill(skill: UnifiedSkill): Promise<void> {
  await mkdir(SKILLS_DIR, { recursive: true });
  const filePath = join(SKILLS_DIR, `${skill.id}.json`);
  await writeFile(filePath, JSON.stringify(skill, null, 2), 'utf-8');

  // Update index
  const index = await loadSkillIndex();
  upsertIndexEntry(index, skill);
  await saveSkillIndex(index);

  logger.info('skill-store', `已儲存技能: ${skill.id}`);
}

export async function deleteSkill(id: string): Promise<boolean> {
  const index = await loadSkillIndex();
  const before = index.skills.length;
  index.skills = index.skills.filter(s => s.id !== id);
  if (index.skills.length === before) return false;

  await saveSkillIndex(index);

  // Remove skill file (best-effort)
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(join(SKILLS_DIR, `${id}.json`));
  } catch { /* ignore */ }

  return true;
}

export async function listSkills(): Promise<SkillIndexEntry[]> {
  const index = await loadSkillIndex();
  return index.skills;
}

/* ── Vault backup ─────────────────────────────────────────── */

export async function saveSkillToVault(skill: UnifiedSkill, vaultPath: string): Promise<string> {
  const dir = join(vaultPath, 'KnowPipe', 'Skills');
  await mkdir(dir, { recursive: true });

  const fileName = `${skill.title.replace(/[/\\:*?"<>|]/g, '-').slice(0, 50)}.md`;
  const filePath = join(dir, fileName);
  const content = toVaultSkillNote(skill);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/** Batch save all skills to vault. */
export async function saveAllSkillsToVault(vaultPath: string): Promise<number> {
  const index = await loadSkillIndex();
  let count = 0;

  for (const entry of index.skills) {
    const skill = await loadSkill(entry.id);
    if (skill) {
      await saveSkillToVault(skill, vaultPath);
      count++;
    }
  }

  return count;
}

/** Mark a skill as synced in the index. */
export async function markSynced(id: string, target: SkillTarget): Promise<void> {
  const index = await loadSkillIndex();
  const entry = index.skills.find(s => s.id === id);
  if (entry) {
    entry.lastSyncAt = new Date().toISOString();
    if (!entry.targets.includes(target)) entry.targets.push(target);
    await saveSkillIndex(index);
  }
}
