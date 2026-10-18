export interface ScorableReport {
  id: string;
  type: 'LOST' | 'FOUND';
  category: string;
  title: string;
  description: string;
  color?: string | null;
  brand?: string | null;
  locationLabel: string;
  locationArea?: string | null;
  occurredAt?: Date | null;
}

export interface MatchScoreResult {
  score: number;
  reasons: string[];
  components: {
    categoryScore: number;
    textScore: number;
    attributeScore: number;
    locationScore: number;
    temporalScore: number;
  };
}

export const MATCH_THRESHOLD = 0.35;
export const ALGORITHM_VERSION = 'v1.0.0-deterministic';

// Category relation groups
const CATEGORY_GROUPS: Record<string, string[]> = {
  electronics: ['electronics', 'computers', 'phones', 'audio', 'gadgets', 'tech', 'headphones', 'tablets'],
  accessories: ['accessories', 'jewelry', 'watches', 'cables', 'chargers', 'cases', 'glasses', 'sunglasses'],
  bags: ['bags', 'backpacks', 'wallets', 'purses', 'luggage'],
  clothing: ['clothing', 'jackets', 'coats', 'hats', 'scarves', 'shoes', 'apparel', 'hoodies'],
  documents: ['documents', 'cards', 'ids', 'passports', 'books', 'notebooks', 'keys', 'wallets'],
};

// Cross-compatible categories that share items (e.g. tech accessories)
const CROSS_COMPATIBLE_PAIRS: Array<[string, string]> = [
  ['electronics', 'accessories'],
  ['bags', 'accessories'],
  ['documents', 'bags'],
];

function normalize(str?: string | null): string {
  return (str || '').trim().toLowerCase();
}

/**
 * Computes Trigram similarity between two strings (0.0 to 1.0).
 */
export function computeTrigramSimilarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  if (normA.length < 3 || normB.length < 3) {
    return normA.includes(normB) || normB.includes(normA) ? 0.75 : 0;
  }

  const trigramsA = new Set<string>();
  for (let i = 0; i <= normA.length - 3; i++) {
    trigramsA.add(normA.substring(i, i + 3));
  }

  const trigramsB = new Set<string>();
  for (let i = 0; i <= normB.length - 3; i++) {
    trigramsB.add(normB.substring(i, i + 3));
  }

  let intersection = 0;
  for (const tri of trigramsA) {
    if (trigramsB.has(tri)) {
      intersection++;
    }
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

/**
 * Computes token Jaccard similarity for description text (0.0 to 1.0).
 */
function computeTokenOverlap(a: string, b: string): number {
  const tokensA = new Set(
    normalize(a)
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );
  const tokensB = new Set(
    normalize(b)
      .split(/\W+/)
      .filter((t) => t.length > 2)
  );

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection++;
    }
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Evaluates candidate pair compatibility according to the deterministic blueprint specification.
 */
export function scoreCandidatePair(
  lost: ScorableReport,
  found: ScorableReport
): MatchScoreResult {
  const reasons: string[] = [];

  // 1. Category Compatibility (Max: 0.25)
  let categoryScore = 0.0;
  const catLost = normalize(lost.category);
  const catFound = normalize(found.category);

  if (catLost === catFound) {
    categoryScore = 0.25;
    reasons.push(`Exact Category: ${lost.category}`);
  } else {
    // Check group compatibility
    let related = false;
    for (const group of Object.values(CATEGORY_GROUPS)) {
      if (group.includes(catLost) && group.includes(catFound)) {
        related = true;
        break;
      }
    }

    if (!related) {
      for (const [g1, g2] of CROSS_COMPATIBLE_PAIRS) {
        const inG1A = CATEGORY_GROUPS[g1]?.includes(catLost);
        const inG2B = CATEGORY_GROUPS[g2]?.includes(catFound);
        const inG2A = CATEGORY_GROUPS[g2]?.includes(catLost);
        const inG1B = CATEGORY_GROUPS[g1]?.includes(catFound);
        if ((inG1A && inG2B) || (inG2A && inG1B)) {
          related = true;
          break;
        }
      }
    }

    if (related) {
      categoryScore = 0.10;
      reasons.push(`Related Category: ${lost.category} ~ ${found.category}`);
    }
  }

  // 2. Full-Text & Trigram Similarity (Max: 0.35)
  // Title trigrams (up to 0.20) + Description token overlap (up to 0.15)
  const titleSim = computeTrigramSimilarity(lost.title, found.title);
  const descSim = computeTokenOverlap(lost.description, found.description);

  const textScore = Number((titleSim * 0.20 + descSim * 0.15).toFixed(4));
  if (titleSim >= 0.3) {
    reasons.push(`Similar Title: ${Math.round(titleSim * 100)}% match`);
  }

  // 3. Color & Brand Attributes (Max: 0.15)
  let attributeScore = 0.0;
  const brandLost = normalize(lost.brand);
  const brandFound = normalize(found.brand);
  if (brandLost && brandFound && (brandLost === brandFound || brandLost.includes(brandFound) || brandFound.includes(brandLost))) {
    attributeScore += 0.075;
    reasons.push(`Matching Brand: ${lost.brand}`);
  }

  const colorLost = normalize(lost.color);
  const colorFound = normalize(found.color);
  if (colorLost && colorFound && (colorLost === colorFound || colorLost.includes(colorFound) || colorFound.includes(colorLost))) {
    attributeScore += 0.075;
    reasons.push(`Matching Color: ${lost.color}`);
  }

  // 4. Location Proximity (Max: 0.15)
  let locationScore = 0.0;
  const locLost = normalize(lost.locationLabel);
  const locFound = normalize(found.locationLabel);
  const areaLost = normalize(lost.locationArea);
  const areaFound = normalize(found.locationArea);

  if (locLost === locFound || locLost.includes(locFound) || locFound.includes(locLost)) {
    locationScore = 0.15;
    reasons.push(`Same Location: ${lost.locationLabel}`);
  } else if (areaLost && areaFound && areaLost === areaFound) {
    locationScore = 0.08;
    reasons.push(`Same Area: ${lost.locationArea}`);
  }

  // 5. Temporal Decay (Max: 0.10)
  let temporalScore = 0.05; // Neutral default when either date is null
  if (lost.occurredAt && found.occurredAt) {
    const diffMs = Math.abs(lost.occurredAt.getTime() - found.occurredAt.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    temporalScore = Number((0.10 * Math.exp(-diffDays / 14.0)).toFixed(4));

    if (diffDays <= 1) {
      reasons.push('Occurred within 24 hours');
    } else if (diffDays <= 7) {
      reasons.push(`Occurred within ${Math.ceil(diffDays)} days`);
    }
  }

  const totalScore = Number(
    Math.min(1.0, categoryScore + textScore + attributeScore + locationScore + temporalScore).toFixed(4)
  );

  return {
    score: totalScore,
    reasons,
    components: {
      categoryScore,
      textScore,
      attributeScore,
      locationScore,
      temporalScore,
    },
  };
}
