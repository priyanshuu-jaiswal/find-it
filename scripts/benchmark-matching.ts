import fs from 'fs';
import path from 'path';
import { scoreCandidatePair, ScorableReport } from '../src/modules/matching/score';

interface EvalScenario {
  id: string;
  description: string;
  lost: ScorableReport & { occurredAt?: string };
  candidates: Array<ScorableReport & { occurredAt?: string }>;
  trueMatchId: string;
}

function runBenchmark() {
  const filePath = path.resolve(process.cwd(), 'tests/fixtures/matching-eval.json');
  if (!fs.existsSync(filePath)) {
    console.error(`Evaluation fixture not found at ${filePath}. Run generate-eval-dataset first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const scenarios: EvalScenario[] = JSON.parse(raw);

  let top1Hits = 0;
  let top5Hits = 0;
  let reciprocalRankSum = 0;
  let totalPrecisionAt5 = 0;
  const start = performance.now();

  console.log(`\n======================================================`);
  console.log(`FindIt Matching Engine Benchmark Evaluation`);
  console.log(`Total Scenarios: ${scenarios.length}`);
  console.log(`======================================================\n`);

  for (const scenario of scenarios) {
    const lostReport: ScorableReport = {
      ...scenario.lost,
      occurredAt: scenario.lost.occurredAt ? new Date(scenario.lost.occurredAt) : undefined,
    };

    // Score all candidates
    const scored = scenario.candidates.map((cand) => {
      const foundReport: ScorableReport = {
        ...cand,
        occurredAt: cand.occurredAt ? new Date(cand.occurredAt) : undefined,
      };
      const result = scoreCandidatePair(lostReport, foundReport);
      return {
        id: cand.id,
        score: result.score,
        reasons: result.reasons,
      };
    });

    // Rank candidates by descending score
    scored.sort((a, b) => b.score - a.score);

    // Find rank of true match (1-indexed)
    const rankIndex = scored.findIndex((c) => c.id === scenario.trueMatchId);
    const rank = rankIndex !== -1 ? rankIndex + 1 : Infinity;

    if (rank === 1) {
      top1Hits++;
    }
    if (rank <= 5) {
      top5Hits++;
      totalPrecisionAt5 += 1 / 5; // 1 relevant item among top 5
    }
    if (rankIndex !== -1) {
      reciprocalRankSum += 1 / rank;
    }
  }

  const totalTimeMs = performance.now() - start;
  const avgTimePerQueryMs = totalTimeMs / scenarios.length;

  const recallAt1 = (top1Hits / scenarios.length) * 100;
  const recallAt5 = (top5Hits / scenarios.length) * 100;
  const precisionAt5 = (totalPrecisionAt5 / scenarios.length) * 100;
  const mrr = reciprocalRankSum / scenarios.length;

  console.log(`Results:`);
  console.log(`------------------------------------------------------`);
  console.log(`Recall@1:       ${recallAt1.toFixed(2)}% (${top1Hits}/${scenarios.length})`);
  console.log(`Recall@5:       ${recallAt5.toFixed(2)}% (${top5Hits}/${scenarios.length})`);
  console.log(`Precision@5:    ${precisionAt5.toFixed(2)}%`);
  console.log(`MRR:            ${mrr.toFixed(4)}`);
  console.log(`Latency:        ${avgTimePerQueryMs.toFixed(3)} ms/query (${totalTimeMs.toFixed(2)} ms total)`);
  console.log(`======================================================\n`);
}

runBenchmark();
