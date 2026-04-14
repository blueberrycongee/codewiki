import type { Layer } from "../../config/schema.js";

export interface LayerDefinition {
  layer: Layer;
  description: string;
  classifyHint: string; // guidance for the classify prompt
  extractFactsPrompt: (repoName: string, repoFullName: string) => string;
  composePagePrompt: (repoName: string) => string;
}

export { decisionLayer } from "./decision.js";
export { evolutionLayer } from "./evolution.js";
export { constraintLayer } from "./constraint.js";
export { pitfallLayer } from "./pitfall.js";
export { conventionLayer } from "./convention.js";

import { decisionLayer } from "./decision.js";
import { evolutionLayer } from "./evolution.js";
import { constraintLayer } from "./constraint.js";
import { pitfallLayer } from "./pitfall.js";
import { conventionLayer } from "./convention.js";

export const ALL_LAYERS: LayerDefinition[] = [
  decisionLayer,
  evolutionLayer,
  constraintLayer,
  pitfallLayer,
  conventionLayer,
];

export function getLayer(name: Layer): LayerDefinition {
  const layer = ALL_LAYERS.find((l) => l.layer === name);
  if (!layer) throw new Error(`Unknown layer: ${name}`);
  return layer;
}
