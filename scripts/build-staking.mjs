#!/usr/bin/env node
// Builds data/staking.js: for every consensus account that our beneficiary wallets have
// XDM'd tokens to, how much that account currently has staked (nominated) on the consensus
// chain. The dashboard joins its live XDM data to this map by receiver account to show the
// "staked" portion of the "XDM'd to consensus" bucket.
//
// Staking lives in the consensus `domains` pallet (not the Auto EVM explorer), so this runs
// at build time via polkadot.js. Deps: @autonomys/auto-utils, @autonomys/auto-consensus.

import fs from 'node:fs';
import { activate } from '@autonomys/auto-utils';

const XDM_INDEXER = 'https://indexer-api.mainnet.autonomys.xyz/v1/xdm';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const log = (m) => process.stderr.write(m + '\n');

const registry = JSON.parse(fs.readFileSync(new URL('../data/registry.json', import.meta.url)));
const wallets = new Set();
for (const g of Object.values(registry.groups)) for (const p of g.plans) wallets.add(p.recipient.toLowerCase());
for (const p of registry.treasury.plans) wallets.add(p.recipient.toLowerCase());

// 1. Enumerate consensus receiver accounts our wallets have XDM'd to, and how much to each.
const xdmToReceiver = {};
let xdmTotal = 0;
const wl = [...wallets];
log(`resolving XDM receivers for ${wl.length} beneficiary wallets...`);
for (const w of wl) {
  try {
    const res = await fetch(`${XDM_INDEXER}/transfers/${w}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    for (const t of await res.json()) {
      if (t.dst_chain === 'Consensus' && (t.sender || '').toLowerCase() === w && t.transfer_successful !== false) {
        const a = Number(t.amount) || 0;
        xdmToReceiver[t.receiver] = (xdmToReceiver[t.receiver] || 0) + a;
        xdmTotal += a;
      }
    }
  } catch (e) { /* skip wallet on transient error */ }
}
const receivers = new Set(Object.keys(xdmToReceiver));
log(`  ${receivers.size} distinct receivers, ${Math.round(xdmTotal).toLocaleString()} AI3 XDM'd to consensus`);

// 2. Read consensus staking (domains pallet) and sum each receiver's nominated position in AI3.
// Uses raw storage queries: the SDK's bulk deposits() list-parser is incompatible with the
// current runtime, but the underlying storage decodes cleanly.
const api = await activate({ networkId: 'mainnet' });
const opSharePrice = {};
async function sharePrice(operatorId) {
  if (operatorId in opSharePrice) return opSharePrice[operatorId];
  const o = (await api.query.domains.operators(operatorId)).toJSON();
  const totalStake = BigInt(o?.currentTotalStake ?? 0);
  const totalShares = BigInt(o?.currentTotalShares ?? 0);
  return (opSharePrice[operatorId] = totalShares > 0n ? Number(totalStake) / Number(totalShares) : 0);
}

const byReceiver = {};
const depositEntries = await api.query.domains.deposits.entries();
log(`  scanning ${depositEntries.length} network deposit entries...`);
for (const [key, val] of depositEntries) {
  const account = key.args[1].toString();
  if (!receivers.has(account)) continue;
  const d = val.toJSON();
  const shares = BigInt(d?.known?.shares ?? 0);
  const pending = BigInt(d?.pending?.amount ?? 0); // pending deposit already denominated in AI3 (shannon)
  const price = await sharePrice(key.args[0].toString());
  const ai3 = (Number(shares) * price + Number(pending)) / 1e18;
  byReceiver[account] = (byReceiver[account] || 0) + ai3;
}
await api.disconnect();

const staking = {
  generatedAt: new Date().toISOString(),
  byReceiver,
  totals: {
    receivers: receivers.size,
    staking: Object.keys(byReceiver).length,
    stakedAI3: Object.values(byReceiver).reduce((s, x) => s + x, 0),
    xdmToConsensusAI3: xdmTotal,
  },
};
log(`  ${staking.totals.staking} receivers staking, ${Math.round(staking.totals.stakedAI3).toLocaleString()} AI3 staked`);

fs.writeFileSync(new URL('../data/staking.json', import.meta.url), JSON.stringify(staking, null, 1));
fs.writeFileSync(new URL('../data/staking.js', import.meta.url), 'window.STAKING = ' + JSON.stringify(staking) + ';\n');
log('wrote data/staking.json and data/staking.js');
process.exit(0);
