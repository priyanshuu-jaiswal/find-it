import fs from 'fs';
import path from 'path';

interface ScorableReportFixture {
  id: string;
  type: 'LOST' | 'FOUND';
  category: string;
  title: string;
  description: string;
  color?: string | null;
  brand?: string | null;
  locationLabel: string;
  locationArea?: string | null;
  occurredAt?: string;
}

interface EvalScenario {
  id: string;
  description: string;
  lost: ScorableReportFixture;
  candidates: ScorableReportFixture[];
  trueMatchId: string;
}

const CATEGORIES = [
  { name: 'Electronics', brands: ['Apple', 'Dell', 'Sony', 'Samsung', 'Bose', 'Anker'], colors: ['Silver', 'Space Gray', 'Black', 'White', 'Blue'] },
  { name: 'Bags', brands: ['North Face', 'Fjallraven', 'Herschel', 'Nike', 'Patagonia'], colors: ['Black', 'Navy', 'Olive Green', 'Burgundy', 'Gray'] },
  { name: 'Documents', brands: ['University', 'State ID', 'Chase', 'Moleskine'], colors: ['Blue', 'Red', 'Black', 'Green'] },
  { name: 'Accessories', brands: ['Ray-Ban', 'Casio', 'Hydro Flask', 'Yeti'], colors: ['Black', 'Silver', 'Matte Black', 'Teal', 'Pink'] },
  { name: 'Clothing', brands: ['Patagonia', 'Nike', 'Champion', 'Adidas', 'Columbia'], colors: ['Navy', 'Charcoal', 'Maroon', 'Black', 'Olive'] }
];

const LOCATIONS = [
  'Main Library 3rd Floor Study Lounge',
  'Student Union Food Court',
  'Engineering Hall Room 204',
  'Campus Recreation Center Locker Room',
  'Science Complex Lecture Hall B',
  'University Dining Hall West',
  'North Campus Bus Terminal',
  'Memorial Quadrangle Benches',
  'Mathematics Department Common Room',
  'Health Sciences Computer Lab'
];

const ITEMS = [
  { cat: 'Electronics', title: 'MacBook Air M2', desc: 'Silver laptop with stickers on top lid (GitHub, React)' },
  { cat: 'Electronics', title: 'AirPods Pro 2nd Gen', desc: 'White charging case in clear silicon case with small scratch' },
  { cat: 'Electronics', title: 'iPhone 15 Pro', desc: 'Natural titanium phone with black otterbox case and cracked screen protector' },
  { cat: 'Electronics', title: 'Sony WH-1000XM4 Headphones', desc: 'Over-ear noise cancelling headphones in black travel pouch' },
  { cat: 'Electronics', title: 'Anker PowerCore 20000mAh', desc: 'Heavy black portable power bank with braided USB-C cable' },
  { cat: 'Electronics', title: 'TI-84 Plus CE Graphing Calculator', desc: 'Pink graphing calculator with slide cover marked with initials' },
  { cat: 'Electronics', title: 'iPad Air 5th Gen', desc: 'Space gray tablet with magnetic folio keyboard case' },
  { cat: 'Bags', title: 'North Face Borealis Backpack', desc: 'Black commuter backpack containing spiral notebook and water bottle' },
  { cat: 'Bags', title: 'Fjallraven Kanken Backpack', desc: 'Ox red classic backpack with side pocket water bottle' },
  { cat: 'Bags', title: 'Leather Bi-fold Wallet', desc: 'Brown leather wallet containing student card and metro pass' },
  { cat: 'Bags', title: 'Herschel Supply Co. Duffle Bag', desc: 'Navy blue duffel bag with shoe compartment' },
  { cat: 'Accessories', title: 'Hydro Flask 32oz Wide Mouth', desc: 'Cobalt blue insulated bottle with flex cap and stickers' },
  { cat: 'Accessories', title: 'Ray-Ban Wayfarer Sunglasses', desc: 'Classic black polarized sunglasses in brown leather case' },
  { cat: 'Accessories', title: 'Set of Dorm Keys on Lanyard', desc: '3 brass keys on red campus safety lanyard with bottle opener' },
  { cat: 'Accessories', title: 'Apple Watch Series 8', desc: 'Midnight aluminum case with sport band size 45mm' },
  { cat: 'Clothing', title: 'Patagonia Better Sweater Fleece', desc: 'Quarter-zip fleece jacket in stonewash gray size Medium' },
  { cat: 'Clothing', title: 'Nike Club Fleece Hoodie', desc: 'Black pullover hoodie with white embroidered swoosh' },
  { cat: 'Clothing', title: 'Columbia Waterproof Raincoat', desc: 'Navy blue lightweight hooded rain jacket size Large' },
  { cat: 'Documents', title: 'Apex University Student ID Card', desc: 'Photo ID card with student number starting in 902' },
  { cat: 'Documents', title: 'Calculus Early Transcendentals Textbook', desc: 'Hardcover 9th edition textbook with highlighted chapter 4' }
];

function generateScenarios(): EvalScenario[] {
  const scenarios: EvalScenario[] = [];
  const baseTime = new Date('2026-10-15T10:00:00Z').getTime();

  for (let i = 0; i < 100; i++) {
    const itemTemplate = ITEMS[i % ITEMS.length];
    const location = LOCATIONS[i % LOCATIONS.length];
    const categoryInfo = CATEGORIES.find(c => c.name === itemTemplate.cat) || CATEGORIES[0];
    const brand = categoryInfo.brands[i % categoryInfo.brands.length];
    const color = categoryInfo.colors[i % categoryInfo.colors.length];
    const timeOffsetDays = (i % 7);
    const lostTime = new Date(baseTime - (timeOffsetDays * 86400000)).toISOString();
    const foundTime = new Date(baseTime - (timeOffsetDays * 86400000) + 7200000).toISOString();

    const lostId = `lost-${i + 1}`;
    const trueFoundId = `found-match-${i + 1}`;

    const lost: ScorableReportFixture = {
      id: lostId,
      type: 'LOST',
      category: itemTemplate.cat,
      title: `Lost ${color} ${brand} ${itemTemplate.title}`,
      description: `${itemTemplate.desc}. Please contact me if found near ${location}.`,
      color,
      brand,
      locationLabel: location,
      locationArea: location.split(' ')[0],
      occurredAt: lostTime
    };

    // Ground truth match with natural phrasing variations
    const trueMatch: ScorableReportFixture = {
      id: trueFoundId,
      type: 'FOUND',
      category: itemTemplate.cat,
      title: `Found ${brand} ${itemTemplate.title} (${color})`,
      description: `Turned in at desk. Matches description: ${itemTemplate.desc}. Found at ${location}.`,
      color,
      brand,
      locationLabel: location,
      locationArea: location.split(' ')[0],
      occurredAt: foundTime
    };

    // 4 Distractor items in the same candidate pool
    const distractors: ScorableReportFixture[] = [];
    for (let d = 1; d <= 4; d++) {
      const distractorIndex = (i + d * 3) % ITEMS.length;
      const distItem = ITEMS[distractorIndex];
      const distLoc = LOCATIONS[(i + d * 2) % LOCATIONS.length];
      const distCat = CATEGORIES.find(c => c.name === distItem.cat) || CATEGORIES[0];
      const distBrand = distCat.brands[(i + d) % distCat.brands.length];
      const distColor = distCat.colors[(i + d) % distCat.colors.length];

      distractors.push({
        id: `found-distractor-${i + 1}-${d}`,
        type: 'FOUND',
        category: distItem.cat,
        title: `Found ${distBrand} ${distItem.title}`,
        description: `Unclaimed item found at ${distLoc}. ${distItem.desc}`,
        color: distColor,
        brand: distBrand,
        locationLabel: distLoc,
        locationArea: distLoc.split(' ')[0],
        occurredAt: new Date(baseTime - (d * 86400000)).toISOString()
      });
    }

    // Shuffle true match among distractors
    const candidatePool = [trueMatch, ...distractors].sort(() => 0.5 - Math.random());

    scenarios.push({
      id: `scenario-${i + 1}`,
      description: `Matching test for ${lost.title}`,
      lost,
      candidates: candidatePool,
      trueMatchId: trueFoundId
    });
  }

  return scenarios;
}

const fixturesDir = path.resolve(process.cwd(), 'tests/fixtures');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

const scenarios = generateScenarios();
const targetPath = path.join(fixturesDir, 'matching-eval.json');
fs.writeFileSync(targetPath, JSON.stringify(scenarios, null, 2), 'utf-8');
console.log(`Generated ${scenarios.length} evaluation scenarios at ${targetPath}`);
