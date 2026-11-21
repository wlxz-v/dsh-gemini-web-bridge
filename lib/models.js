// lib/models.js — 1:1 Aligned with the 2026 Official Google Gemini 4 Family Catalog & Upstream Route Mapping
// Strictly adheres to truth: no fake aliases, no artificial entitlement simulation.

/**
 * Official Google Gemini Catalog Candidates
 * - Gemini 4 Hydrogen: 极速响应、日常高频任务（取代 Flash 系列，直连 Gemini 4 核心通道）
 * - Gemini 4 Neon: 均衡型主力模型，定位介于 Hydrogen 与 Carbon 之间（直连 Gemini 4 均衡通道）
 * - Gemini 自动模式: 官方智能自适应路由
 * - Gemini 4 Carbon: 深度工程推理（Chai 专属高阶模型，需账号具备相应订阅，探活若降级则自动剔除）
 * - Nano Banana: 图像生成与多轮编辑（专攻生图，若无文本会话权限则自动剔除）
 * Note: Gemini Nano 4 属于手机 / XR 设备端侧离线模型，在 Google 云端 Web 服务中完全不存在，绝不列入云端探活。
 */
export const CANDIDATE_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    backendId: 'gemini-4-argon',
    name: 'Gemini 4 Hydrogen (极速响应 · 日常高频任务 · 取代原 Flash 系列)',
    officialLabel: 'Gemini 4 Hydrogen',
    location: '云端',
    category: 'fast',
    description: '官方高频主力云端模型，取代 Flash 系列，直连 Gemini 4 核心算力通道，极度适合智能体日常驱动与高频工具调用'
  },
  {
    id: 'gemini-4-neon',
    backendId: 'gemini-4-argon@think=2',
    name: 'Gemini 4 Neon (均衡型主力模型 · 介于 Hydrogen 与 Carbon 之间)',
    officialLabel: 'Gemini 4 Neon',
    location: '云端',
    category: 'balanced',
    description: '均衡型主力模型，平衡思维深度与生成速度，适合中等复杂度方案评估'
  },
  {
    id: 'gemini-auto',
    backendId: 'gemini-auto',
    name: 'Gemini 自动模式 (Auto · 官方智能自适应)',
    officialLabel: '自动 (Auto)',
    location: '云端',
    category: 'auto',
    description: '官方智能自适应路由，根据对话复杂度与推理需求自动匹配最优底层算力'
  },
  {
    id: 'gemini-4-carbon',
    backendId: 'gemini-4-carbon',
    name: 'Gemini 4 Carbon (复杂推理 · 深度研究 · 高难度工程任务)',
    officialLabel: 'Gemini 4 Carbon',
    location: '云端',
    category: 'planner',
    description: '官方最高阶科研推理模型（需账号具备 Chai 订阅权限，若未解锁将自动排除）'
  },
  {
    id: 'nano-banana',
    backendId: 'nano-banana',
    name: 'Nano Banana (图像生成与多轮编辑模型 · 专攻生图)',
    officialLabel: 'Nano Banana',
    location: '云端',
    category: 'image',
    description: '专攻视觉生成与图像编辑模型（非文本对话模型，若无文本接口将自动排除）'
  }
];

export const OFFICIAL_MODELS = CANDIDATE_MODELS;

/**
 * Model Route Alias Dictionary
 * Maps front-end/UI identifiers to the genuine native backend IDs.
 * Real, authentic routes only — NO FAKE MAPPINGS to prevent false entitlement pulls.
 */
export const MODEL_ROUTE_MAP = {
  // Gemini 4 Hydrogen (Cloud High-Frequency Flagship -> Gemini 4 native core channel)
  'gemini-4-hydrogen': 'gemini-4-argon',
  '4-hydrogen': 'gemini-4-argon',
  'hydrogen': 'gemini-4-argon',

  // Gemini 4 Neon (Balanced Thinking -> Gemini 4 balanced thinking @think=2)
  'gemini-4-neon': 'gemini-4-argon@think=2',
  '4-neon': 'gemini-4-argon@think=2',
  'neon': 'gemini-4-argon@think=2',

  // Gemini Auto (Online Auto mode)
  'gemini-auto': 'gemini-auto',
  'auto': 'gemini-auto',
  '自动': 'gemini-auto',

  // Gemini 4 Carbon (Direct upstream route — let Google verify real account entitlement)
  'gemini-4-carbon': 'gemini-4-carbon',
  '4-carbon': 'gemini-4-carbon',
  'carbon': 'gemini-4-carbon',

  // Nano Banana (Direct upstream route — let Google verify real account entitlement)
  'nano-banana': 'nano-banana',
  'banana': 'nano-banana',

  // Direct Upstream Native Identifiers (Pass-through)
  'gemini-4-argon': 'gemini-4-argon',
  'gemini-4': 'gemini-4-argon',
  'argon': 'gemini-4-argon',

  // Legacy fallback aliases
  'gemini-3.8-flash': 'gemini-4-argon',
  'gemini-3.7-flash': 'gemini-4-argon',
  'gemini-3.6-flash': 'gemini-4-argon',
  'gemini-3.5-flash': 'gemini-4-argon',
};

/**
 * Resolves any model alias to its native upstream identifier.
 */
export function resolveBackendModel(modelId) {
  if (!modelId) return 'gemini-auto';
  const clean = modelId.split('@')[0].trim().toLowerCase();
  const suffix = modelId.includes('@') ? '@' + modelId.split('@')[1] : '';
  const mapped = MODEL_ROUTE_MAP[clean] || clean;
  return mapped + suffix;
}

/**
 * Generates provider YAML block for DSH settings.yaml & cordis.patch.yml
 */
export function buildProviderYaml(models = CANDIDATE_MODELS, port = 51130) {
  const lines = [
    '      api: openai-completions',
    `      baseURL: http://127.0.0.1:${port}/v1`,
    '      apiKey: sk-gemini-web',
    '      models:',
  ];
  for (const m of models) {
    lines.push(`        - id: ${m.id}`);
    lines.push(`          name: "${m.name}"`);
  }
  return lines;
}
