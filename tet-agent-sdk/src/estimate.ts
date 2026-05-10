const VISION_EST_FLOPS_PER_TOKEN = 1_000_000;

export function estimateVisionInferFlopsFromPromptChars(charCount: number): bigint {
  const tokens = Math.max(1, Math.floor(charCount / 4));
  return BigInt(tokens) * BigInt(VISION_EST_FLOPS_PER_TOKEN);
}

export type InferCostEstimateJson = {
  total_micro_ledger: number;
  to_worker_reward_micro?: number;
  to_protocol_burn_micro?: number;
};
