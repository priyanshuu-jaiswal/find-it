import { describe, it, expect } from 'vitest';
import { scoreCandidatePair, computeTrigramSimilarity, ScorableReport } from '@/src/modules/matching/score';

describe('Deterministic Candidate Scorer (score.ts)', () => {
  it('computes character trigram similarity accurately', () => {
    // Exact match
    expect(computeTrigramSimilarity('MacBook Pro', 'MacBook Pro')).toBe(1);

    // Minor typo
    const simHigh = computeTrigramSimilarity('MacBook Pro 14', 'Macbok Pro 14');
    expect(simHigh).toBeGreaterThan(0.7);

    // Completely different
    const simLow = computeTrigramSimilarity('Apple Laptop', 'Leather Jacket');
    expect(simLow).toBeLessThan(0.1);
  });

  it('accurately scores high-compatibility matching items with human-readable reasons', () => {
    const lostReport: ScorableReport = {
      id: 'lost-1',
      type: 'LOST',
      category: 'Electronics',
      title: 'Apple MacBook Pro 14 inch space gray',
      description: 'Lost my laptop in the science building lecture hall 101 on Monday afternoon.',
      brand: 'Apple',
      color: 'Gray',
      locationLabel: 'Science Center Room 101',
      locationArea: 'North Campus',
      occurredAt: new Date('2026-10-15T14:00:00Z'),
    };

    const foundReport: ScorableReport = {
      id: 'found-1',
      type: 'FOUND',
      category: 'Electronics',
      title: 'Found Apple MacBook laptop in science center',
      description: 'Someone left an Apple laptop in the lecture hall room 101.',
      brand: 'Apple',
      color: 'Gray',
      locationLabel: 'Science Center Room 101',
      locationArea: 'North Campus',
      occurredAt: new Date('2026-10-15T16:30:00Z'), // ~2.5 hours later
    };

    const result = scoreCandidatePair(lostReport, foundReport);

    // Category: 0.25 (exact)
    expect(result.components.categoryScore).toBe(0.25);
    // Attributes: 0.15 (brand + color)
    expect(result.components.attributeScore).toBe(0.15);
    // Location: 0.15 (exact locationLabel match)
    expect(result.components.locationScore).toBe(0.15);
    // Temporal: close to 0.10 (occurred within 2.5 hours)
    expect(result.components.temporalScore).toBeGreaterThan(0.09);
    // Text: trigram similarity and description overlap
    expect(result.components.textScore).toBeGreaterThan(0.10);

    // Total score should easily clear the 0.35 threshold (typically > 0.75)
    expect(result.score).toBeGreaterThan(0.75);

    // Reasons should be transparent
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Category: Electronics'),
        expect.stringContaining('Matching Brand: Apple'),
        expect.stringContaining('Matching Color: Gray'),
        expect.stringContaining('Same Location: Science Center Room 101'),
        expect.stringContaining('Occurred within 24 hours'),
      ])
    );
  });

  it('awards partial score for related categories (Electronics ~ Accessories)', () => {
    const lostItem: ScorableReport = {
      id: 'lost-2',
      type: 'LOST',
      category: 'Electronics',
      title: 'USB-C Fast Charging Cable',
      description: 'White Apple braided USB-C cable left in student union.',
      locationLabel: 'Student Union',
    };

    const foundItem: ScorableReport = {
      id: 'found-2',
      type: 'FOUND',
      category: 'Accessories',
      title: 'White charging cable',
      description: 'Found a white cable on the sofa in the student union.',
      locationLabel: 'Student Union',
    };

    const result = scoreCandidatePair(lostItem, foundItem);
    expect(result.components.categoryScore).toBe(0.10);
    expect(result.reasons).toContain('Related Category: Electronics ~ Accessories');
  });

  it('scores completely unrelated items below threshold (0.35)', () => {
    const lostItem: ScorableReport = {
      id: 'lost-3',
      type: 'LOST',
      category: 'Clothing',
      title: 'Red Winter Beanie Hat',
      description: 'Warm wool hat left in the dining hall.',
      color: 'Red',
      locationLabel: 'Dining Hall',
    };

    const foundItem: ScorableReport = {
      id: 'found-3',
      type: 'FOUND',
      category: 'Electronics',
      title: 'Graphing Calculator TI-84',
      description: 'Found in the math department hallway.',
      color: 'Black',
      brand: 'Texas Instruments',
      locationLabel: 'Math Building Hallway',
    };

    const result = scoreCandidatePair(lostItem, foundItem);
    expect(result.score).toBeLessThan(0.35);
  });
});
