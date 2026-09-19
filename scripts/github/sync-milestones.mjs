#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ghList, ghSend } from './gh.mjs';

const ROADMAP_FILE = new URL('../../shared/config/roadmap.json', import.meta.url);
const NUMBERED_TITLE = /^(\d+)\.\s/;

/** Turns roadmap.json into GitHub milestones titled "<number>. <title>", with the summary as the description. */
export function desiredMilestones(roadmap) {
  if (!Array.isArray(roadmap?.milestones)) throw new Error('roadmap.json has no "milestones" array.');
  const seen = new Set();
  return roadmap.milestones.map(({ number, title, summary }) => {
    if (!Number.isInteger(number)) throw new Error(`Milestone "${title}" needs an integer number.`);
    if (seen.has(number)) throw new Error(`Duplicate milestone number ${number}.`);
    seen.add(number);
    if (typeof title !== 'string' || !title.trim()) throw new Error(`Milestone ${number} needs a title.`);
    if (typeof summary !== 'string' || !summary.trim()) throw new Error(`Milestone ${number} needs a summary.`);
    return { order: number, title: `${number}. ${title}`, description: summary };
  });
}

/**
 * Matches existing milestones by their leading number so retitling a roadmap entry updates the
 * milestone rather than duplicating it. State is never touched: a closed milestone stays closed.
 */
export function planMilestoneSync(desired, existing) {
  const byOrder = new Map();
  const unmanaged = [];
  for (const milestone of existing) {
    const order = milestone.title.match(NUMBERED_TITLE)?.[1];
    if (order === undefined) unmanaged.push(milestone.title);
    else byOrder.set(Number(order), milestone);
  }
  const create = [];
  const update = [];
  for (const wanted of desired) {
    const found = byOrder.get(wanted.order);
    byOrder.delete(wanted.order);
    if (!found) create.push(wanted);
    else if (found.title !== wanted.title || (found.description ?? '') !== wanted.description) update.push({ ...wanted, githubNumber: found.number });
  }
  for (const leftover of byOrder.values()) unmanaged.push(leftover.title);
  return { create, update, unmanaged };
}

export function applyMilestonePlan(plan, send = ghSend) {
  for (const { title, description } of plan.create) {
    send('POST', 'repos/{owner}/{repo}/milestones', { title, description, state: 'open' });
  }
  for (const { githubNumber, title, description } of plan.update) {
    send('PATCH', `repos/{owner}/{repo}/milestones/${githubNumber}`, { title, description });
  }
}

function describe(plan) {
  const lines = [
    ...plan.create.map((milestone) => `+ create  ${milestone.title}`),
    ...plan.update.map((milestone) => `~ update  #${milestone.githubNumber} -> ${milestone.title}`),
    ...plan.unmanaged.map((title) => `? not from roadmap.json (left alone)  ${title}`),
  ];
  return lines.length ? lines.join('\n') : 'Milestones are already in sync.';
}

function main() {
  const apply = process.argv.includes('--apply');
  const desired = desiredMilestones(JSON.parse(readFileSync(ROADMAP_FILE, 'utf8')));
  const plan = planMilestoneSync(desired, ghList('repos/{owner}/{repo}/milestones?state=all&per_page=100'));
  console.log(describe(plan));
  if (!apply) {
    console.log('\nDry run. Pass --apply to make these changes.');
    return;
  }
  applyMilestonePlan(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
