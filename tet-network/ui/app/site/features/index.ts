/** Every section of the public site, in the order of the home page's cards. Each section file owns its own entry. */
import * as tags from "./tags";
import * as machines from "./machines";
import * as keys from "./keys";
import * as services from "./services";
import * as research from "./research";
import type { Feature, Section } from "../types";

export const SECTIONS: { section: Section; features: Feature[] }[] = [
  { section: tags.SECTION, features: tags.FEATURES },
  { section: machines.SECTION, features: machines.FEATURES },
  { section: keys.SECTION, features: keys.FEATURES },
  { section: services.SECTION, features: services.FEATURES },
  { section: research.SECTION, features: research.FEATURES },
];

/** Look a feature up by id (FeatureCard renders only registered features). */
export function feature(id: string): Feature {
  for (const s of SECTIONS) for (const f of s.features) if (f.id === id) return f;
  throw new Error(`no feature "${id}" in app/site/features`);
}
