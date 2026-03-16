/**
 * Tool Wall Index — build tool index from knowledge entities,
 * compute activity status, and match new tools via tag similarity.
 */
import type { VaultKnowledge, KnowledgeEntity, NoteAnalysis } from '../knowledge/types.js';
import type { ToolEntry, ToolActivity, ActivityStatus, MentionPoint, ToolMatchResult } from './wall-types.js';

const TOOL_ENTITY_TYPES = new Set(['tool', 'framework', 'platform', 'technology', 'language']);
const NEW_THRESHOLD_DAYS = 7;
const RECENT_WINDOW_DAYS = 14;
const RISING_MULTIPLIER = 1.5;
const MIN_TAGS_FOR_MATCH = 2;
const MATCH_THRESHOLD = 0.3;
const SAME_CATEGORY_BONUS = 0.2;

/** Build tool index from VaultKnowledge global entities + note metadata */
export function buildToolIndex(knowledge: VaultKnowledge): ToolEntry[] {
  const entities = knowledge.globalEntities;
  if (!entities) return buildFromNotes(knowledge);

  const tools: ToolEntry[] = [];

  for (const [key, entity] of Object.entries(entities)) {
    if (!TOOL_ENTITY_TYPES.has(entity.type)) continue;
    if (entity.mentions < 1) continue;

    const { tags, category, firstSeen, lastSeen, timeline } =
      extractMetadataFromNotes(entity, knowledge);

    tools.push({
      name: entity.name,
      aliases: entity.aliases,
      type: entity.type,
      category,
      tags,
      noteIds: entity.noteIds,
      firstSeenAt: firstSeen,
      lastSeenAt: lastSeen,
      mentionTimeline: timeline,
    });
  }

  return tools;
}

/** Fallback: build from note-level entities when globalEntities is empty */
function buildFromNotes(knowledge: VaultKnowledge): ToolEntry[] {
  const merged = new Map<string, ToolEntry>();

  for (const note of Object.values(knowledge.notes)) {
    for (const entity of note.entities) {
      if (!TOOL_ENTITY_TYPES.has(entity.type)) continue;
      const key = entity.name.toLowerCase();
      const existing = merged.get(key);
      const date = note.analyzedAt.slice(0, 10);
      const month = note.analyzedAt.slice(0, 7);

      if (existing) {
        existing.noteIds.push(note.noteId);
        if (date < existing.firstSeenAt) existing.firstSeenAt = date;
        if (date > existing.lastSeenAt) existing.lastSeenAt = date;
        updateTimeline(existing.mentionTimeline, month);
        mergeAliases(existing.aliases, entity.aliases);
      } else {
        merged.set(key, {
          name: entity.name,
          aliases: [...entity.aliases],
          type: entity.type,
          category: note.category,
          tags: extractTagsFromNote(note),
          noteIds: [note.noteId],
          firstSeenAt: date,
          lastSeenAt: date,
          mentionTimeline: [{ month, count: 1 }],
        });
      }
    }
  }

  return [...merged.values()];
}

/** Extract metadata (tags, dates, timeline) from all notes mentioning an entity */
function extractMetadataFromNotes(
  entity: KnowledgeEntity,
  knowledge: VaultKnowledge,
): { tags: string[]; category: string; firstSeen: string; lastSeen: string; timeline: MentionPoint[] } {
  const tagSet = new Set<string>();
  let category = '其他';
  let firstSeen = '9999-12-31';
  let lastSeen = '0000-01-01';
  const timeline: MentionPoint[] = [];

  for (const noteId of entity.noteIds) {
    const note = knowledge.notes[noteId];
    if (!note) continue;

    for (const tag of extractTagsFromNote(note)) tagSet.add(tag);

    if (!category || category === '其他') category = note.category;
    const date = note.analyzedAt.slice(0, 10);
    const month = note.analyzedAt.slice(0, 7);
    if (date < firstSeen) firstSeen = date;
    if (date > lastSeen) lastSeen = date;
    updateTimeline(timeline, month);
  }

  if (firstSeen === '9999-12-31') firstSeen = new Date().toISOString().slice(0, 10);
  if (lastSeen === '0000-01-01') lastSeen = firstSeen;

  return { tags: [...tagSet], category, firstSeen, lastSeen, timeline };
}

/** Extract functional tags from a note's entities and keywords-like data */
function extractTagsFromNote(note: NoteAnalysis): string[] {
  const tags: string[] = [];
  // Use category path segments as tags
  for (const seg of note.category.split('/')) {
    const t = seg.trim().toLowerCase();
    if (t && t.length >= 2) tags.push(t);
  }
  // Use entity names as tags
  for (const e of note.entities) {
    tags.push(e.name.toLowerCase());
  }
  return tags;
}

function updateTimeline(timeline: MentionPoint[], month: string): void {
  const existing = timeline.find(p => p.month === month);
  if (existing) existing.count++;
  else timeline.push({ month, count: 1 });
}

function mergeAliases(target: string[], source: string[]): void {
  for (const a of source) {
    if (!target.includes(a)) target.push(a);
  }
}

/** Compute activity status for each tool */
export function computeToolActivity(tools: ToolEntry[], dormantDays: number): ToolActivity[] {
  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_DAYS * 86_400_000;
  const newCutoff = now - NEW_THRESHOLD_DAYS * 86_400_000;
  const dormantCutoff = now - dormantDays * 86_400_000;

  return tools.map(tool => {
    const lastTs = new Date(tool.lastSeenAt).getTime();
    const firstTs = new Date(tool.firstSeenAt).getTime();
    const daysSinceLast = Math.floor((now - lastTs) / 86_400_000);
    const totalMentions = tool.noteIds.length;

    // Count recent mentions (notes seen after recentCutoff)
    // Approximate: use timeline data
    const currentMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(now - 30 * 86_400_000).toISOString().slice(0, 7);
    const recentMentions = tool.mentionTimeline
      .filter(p => p.month >= prevMonth)
      .reduce((s, p) => s + p.count, 0);

    // Monthly average
    const months = Math.max(1, tool.mentionTimeline.length);
    const monthlyAvg = totalMentions / months;

    let status: ActivityStatus;
    if (firstTs >= newCutoff) {
      status = 'new';
    } else if (lastTs < dormantCutoff) {
      status = 'dormant';
    } else if (recentMentions > monthlyAvg * RISING_MULTIPLIER && recentMentions >= 2) {
      status = 'rising';
    } else {
      status = lastTs >= recentCutoff ? 'active' : 'dormant';
    }

    return { name: tool.name, status, totalMentions, recentMentions, daysSinceLastMention: daysSinceLast };
  });
}

/** Match a newly saved note against the tool index using Jaccard tag similarity */
export function matchNewTool(
  newTitle: string,
  newKeywords: string[],
  newCategory: string,
  newUrl: string,
  index: ToolEntry[],
): ToolMatchResult | null {
  if (index.length === 0) return null;

  const newTags = new Set([
    ...newKeywords.map(k => k.toLowerCase()),
    ...newCategory.split('/').map(s => s.trim().toLowerCase()).filter(s => s.length >= 2),
  ]);

  if (newTags.size < MIN_TAGS_FOR_MATCH) return null;

  const matches: ToolMatchResult['matchedExisting'] = [];

  for (const tool of index) {
    if (tool.tags.length < MIN_TAGS_FOR_MATCH) continue;

    const toolTags = new Set(tool.tags);
    const intersection = [...newTags].filter(t => toolTags.has(t)).length;
    const union = new Set([...newTags, ...toolTags]).size;
    let similarity = union > 0 ? intersection / union : 0;

    // Same category bonus
    if (newCategory.split('/')[0] === tool.category.split('/')[0]) {
      similarity = Math.min(1, similarity + SAME_CATEGORY_BONUS);
    }

    if (similarity >= MATCH_THRESHOLD) {
      // Determine relation type from knowledge relations if available
      const relation = similarity >= 0.6 ? 'alternative' as const : 'complement' as const;
      matches.push({ name: tool.name, similarity, relation });
    }
  }

  if (matches.length === 0) return null;

  // Sort by similarity descending, keep top 3
  matches.sort((a, b) => b.similarity - a.similarity);
  const topMatches = matches.slice(0, 3);

  return { newToolName: newTitle, newToolUrl: newUrl, matchedExisting: topMatches };
}
