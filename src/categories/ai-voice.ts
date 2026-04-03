/** AI 語音相關分類規則 */

export interface CategoryRule {
  name: string;
  keywords: string[];
  exclude?: string[];  // 命中任一排除詞則跳過此分類
}

export const CATEGORIES: CategoryRule[] = [
  // ── 15. 多模態生成/語音 ──
  {
    name: 'AI/多模態生成/語音',
    keywords: [
      '語音輸入', '語音識別', '語音轉文字', '語音轉錄',
      'speech-to-text', 'speech to text', 'speech recognition',
      'whisper', 'stt', '轉錄', '聽寫', 'dictation',
      'voice input', 'voice typing', '語音打字',
      'sherpaonnx', 'sherpa-onnx', 'macparakeet', 'type4me', 'typeno',
    ],
  },
];