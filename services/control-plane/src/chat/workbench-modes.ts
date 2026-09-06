// Workbench feature router — maps user-facing modes to gateway task slugs
// and picks the right model when the user has not pinned one. All model
// names come from the accounts/discovered_models catalog (never invented).
import { Pool } from 'pg';

export type WorkbenchMode =
  | 'chat' | 'image' | 'video' | 'audio' | 'translate'
  | 'research' | 'code' | 'vision' | 'web-search';

interface ModeSpec {
  taskSlug: string;           // gateway X-Simha-Task / model_capabilities slug
  outputModality?: string;    // gateway X-Simha-Output-Modality
  capabilityNeedles: string[];// model-name needles for model picking
  label: string;
}

export const MODES: Record<WorkbenchMode, ModeSpec> = {
  chat:       { taskSlug: 'text-generation',      capabilityNeedles: [],                       label: 'Chat' },
  image:      { taskSlug: 'text-to-image',        outputModality: 'image', capabilityNeedles: ['flux', 'gpt-image', 'imagen', 'sdxl'], label: 'Image' },
  video:      { taskSlug: 'text-to-video',        outputModality: 'video', capabilityNeedles: ['veo', 'sora', 'kling', 'minimax', 'seedance'], label: 'Video' },
  audio:      { taskSlug: 'text-to-speech',       outputModality: 'audio', capabilityNeedles: ['tts', 'elevenlabs', 'suno', 'audio'], label: 'Audio' },
  translate:  { taskSlug: 'translation',          capabilityNeedles: [],                       label: 'Translate' },
  research:   { taskSlug: 'text-generation',      capabilityNeedles: [],                       label: 'Deep Research' },
  code:       { taskSlug: 'code-generation',      capabilityNeedles: [],                       label: 'Code' },
  vision:     { taskSlug: 'image-text-to-text',   capabilityNeedles: ['vision', '4o', 'gemini', 'vl'], label: 'Vision' },
  'web-search': { taskSlug: 'text-generation',    capabilityNeedles: [],                       label: 'Web Search' },
};

/** Pick the best enabled model for a mode: capability record first, then
 *  name-needle heuristic, then any eligible model (SelectModel handles ELO). */
export async function pickModelForMode(
  pool: Pool,
  mode: WorkbenchMode,
): Promise<{ model: string; kind: 'capability' | 'needle' | 'fallback' } | null> {
  const spec = MODES[mode];
  if (!spec) return null;

  // 1) capability record with an enabled discovered model
  if (mode !== 'chat' && mode !== 'research' && mode !== 'code' && mode !== 'web-search') {
    const { rows } = await pool.query(
      `SELECT dm.model FROM model_capabilities mc
       JOIN discovered_models dm ON dm.model = mc.model AND dm.enabled = true
       WHERE mc.capability_slug = $1
       GROUP BY dm.model
       ORDER BY COUNT(DISTINCT mc.account_name) DESC
       LIMIT 1`,
      [spec.taskSlug]);
    if (rows.length) return { model: rows[0].model as string, kind: 'capability' };
  }

  // 2) name-needle heuristic over enabled models
  for (const needle of spec.capabilityNeedles) {
    const { rows } = await pool.query(
      `SELECT model FROM discovered_models
       WHERE enabled = true AND model ILIKE $1
       ORDER BY model LIMIT 1`,
      [`%${needle}%`]);
    if (rows.length) return { model: rows[0].model as string, kind: 'needle' };
  }

  // 3) fallback: any text model (research/code/translate ride text models)
  const { rows } = await pool.query(
    `SELECT model FROM discovered_models
     WHERE enabled = true AND model NOT ILIKE ANY($1)
     ORDER BY model LIMIT 1`,
    [['%flux%', '%image%', '%video%', '%veo%', '%kling%', '%tts%', '%suno%']]);
  return rows.length ? { model: rows[0].model as string, kind: 'fallback' } : null;
}