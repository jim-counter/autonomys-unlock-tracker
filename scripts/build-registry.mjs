#!/usr/bin/env node
// Builds data/registry.json + data/registry.js: every Hedgey plan on Auto EVM holding
// WAI3, attributed to a group by the wallet that created it (per the official wallets
// forum post). Plans from creators outside the official set are Ambassadors program
// grants (confirmed by the Foundation); their creator address is recorded per plan.

const BASE = 'https://explorer.auto-evm.mainnet.autonomys.xyz/api/v2';
const WAI3 = '0x7ba06c7374566c68495f7e4690093521f6b991bb';
const MIN_PLAN_AMOUNT = 100n * 10n ** 18n; // plans below this are test grants, not real allocations
const LOCKERS = {
  lockup: '0x06B6D0AbD9dfC7F04F478B089FD89d4107723264',
  vesting: '0x2CDE9919e81b20B4B33DD562a48a84b54C48F00C',
};

const GROUP_ADMINS = {
  '0x42abfed9d4d9af06db50a80038a334bc5e88e9eb': 'Investors',
  '0xdb2278a91c8b5da8585321136d2dda49d0cd8f9f': 'Team',
  '0x99c2cb8d62fc041d21367084ce0dec646de6da73': 'Advisors',
  '0xe6a6dcffb470031d4eee2cc9f83fc8d5135496de': 'Vendors',
};
const TREASURY_CREATORS = {
  '0xb29f4885810749da79a1be7c5ef3f3c02fc45485': 'Foundation Long-Term Treasury',
  '0xef0eaa2938f0dd71be633a89552143652fbaf00c': 'Autonomys Labs Treasury',
};
// The Long-Term Treasury and Labs Treasury funding wallets are omitted here: they only
// existed to fill the Hedgey lockups and will not be used again.
const TREASURY_WALLETS = [
  { name: 'Foundation Near-Term Treasury', address: '0x0CE164559900cc9BE9b61cCac7dC6A32cbE4A763' },
  { name: 'Market Liquidity', address: '0x09884e157cbA9844d7F29ce52Ca04BF0146F3f06' },
  { name: 'Operations', address: '0xc48f24BE2Df32d6f2c2c34a9E2EB1Ff420f572E0' },
  { name: 'Ambassadors', address: '0xb7ce125198D190814401a6C31866B206Cb71EbF3' },
  { name: 'Game of Domains', address: '0xC73995e20Cb56f4E9851e97474B9c6aF95DFf144' },
  { name: 'Guardians of Growth', address: '0xF54751A0fe7a6221589EFE1892ae8E9Cee85fD0f' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`rate limited: ${url}`);
}

async function planCreations(locker, type) {
  const out = [];
  let params = {};
  for (let page = 0; page < 200; page++) {
    const d = await api(`/addresses/${locker}/logs`, params);
    for (const l of d.items) {
      const dec = l.decoded;
      if (!dec || !dec.method_call.startsWith('PlanCreated')) continue;
      const p = Object.fromEntries(dec.parameters.map((x) => [x.name, x.value]));
      if (p.token.toLowerCase() !== WAI3) continue;
      if (BigInt(p.amount) < MIN_PLAN_AMOUNT) continue;
      out.push({
        planId: p.id,
        type,
        recipient: p.recipient,
        amount: p.amount,
        start: Number(p.start),
        cliff: Number(p.cliff),
        rate: p.rate,
        period: Number(p.period),
        txHash: l.transaction_hash,
        createdAt: l.block_timestamp,
      });
    }
    if (!d.next_page_params) break;
    params = d.next_page_params;
    await sleep(250);
  }
  return out;
}

// Creator = the contract account that initiated the plan. Safe multisigs create plans
// via execTransaction, where tx.from is just the executing owner key, so use tx.to.
const txCreatorCache = new Map();
async function creatorOf(txHash) {
  if (txCreatorCache.has(txHash)) return txCreatorCache.get(txHash);
  const tx = await api(`/transactions/${txHash}`);
  const method = tx.decoded_input ? tx.decoded_input.method_call : (tx.method || '');
  const creator = /^execTransaction/.test(method || '')
    ? tx.to.hash.toLowerCase()
    : tx.from.hash.toLowerCase();
  txCreatorCache.set(txHash, creator);
  await sleep(200);
  return creator;
}

process.stderr.write('scanning PlanCreated events...\n');
const allPlans = [
  ...(await planCreations(LOCKERS.lockup, 'lockup')),
  ...(await planCreations(LOCKERS.vesting, 'vesting')),
];
process.stderr.write(`${allPlans.length} WAI3 plans found\n`);

const registry = {
  generatedAt: new Date().toISOString(),
  lockers: LOCKERS,
  groups: {},
  treasury: { plans: [], wallets: TREASURY_WALLETS },
};
for (const g of [...Object.values(GROUP_ADMINS), 'Ambassadors']) {
  registry.groups[g] = { plans: [] };
}

const ambassadorCreators = new Map();
for (const plan of allPlans) {
  const creator = await creatorOf(plan.txHash);
  if (GROUP_ADMINS[creator]) {
    registry.groups[GROUP_ADMINS[creator]].plans.push(plan);
  } else if (TREASURY_CREATORS[creator]) {
    registry.treasury.plans.push({ ...plan, name: TREASURY_CREATORS[creator], creator });
  } else {
    registry.groups.Ambassadors.plans.push({ ...plan, creator });
    ambassadorCreators.set(creator, (ambassadorCreators.get(creator) || 0) + 1);
  }
}

for (const [g, gd] of Object.entries(registry.groups)) {
  const total = gd.plans.reduce((s, p) => s + BigInt(p.amount), 0n);
  process.stderr.write(`${g}: ${gd.plans.length} plans, ${total / 10n ** 18n} AI3\n`);
}
for (const p of registry.treasury.plans) {
  process.stderr.write(`treasury ${p.name}: plan ${p.planId}, ${BigInt(p.amount) / 10n ** 18n} AI3\n`);
}
process.stderr.write('ambassador plan creators: ' +
  JSON.stringify(Object.fromEntries(ambassadorCreators)) + '\n');

const fs = await import('node:fs');
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('../data/registry.json', import.meta.url),
  JSON.stringify(registry, null, 1)
);
// registry.js lets index.html load the data via <script src>, which works from file://
fs.writeFileSync(
  new URL('../data/registry.js', import.meta.url),
  'window.REGISTRY = ' + JSON.stringify(registry) + ';\n'
);
process.stderr.write('wrote data/registry.json and data/registry.js\n');
