#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ghList, ghSend } from './gh.mjs';

const LABELS_FILE = new URL('../../.github/labels.json', import.meta.url);
const MAX_DESCRIPTION_LENGTH = 100;
const COLOUR_PATTERN = /^[0-9a-f]{6}$/i;

export function validateLabels(labels) {
  const seen = new Set();
  for (const label of labels) {
    if (typeof label.name !== 'string' || !label.name.trim()) throw new Error('Every label needs a non-empty name.');
    if (!COLOUR_PATTERN.test(label.color ?? '')) throw new Error(`Label "${label.name}" needs a 6-digit hex colour without "#".`);
    if (typeof label.description !== 'string') throw new Error(`Label "${label.name}" needs a description (use "" for none).`);
    if (label.description.length > MAX_DESCRIPTION_LENGTH) throw new Error(`Label "${label.name}" description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`);
    const key = label.name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate label "${label.name}" (names are case-insensitive).`);
    seen.add(key);
  }
}

/** Compares the desired labels with the repository's. It never plans a deletion; extra labels are only reported. */
export function planLabelSync(desired, existing) {
  const current = new Map(existing.map((label) => [label.name.toLowerCase(), label]));
  const create = [];
  const update = [];
  for (const label of desired) {
    const found = current.get(label.name.toLowerCase());
    current.delete(label.name.toLowerCase());
    if (!found) {
      create.push(label);
    } else if (found.name !== label.name || found.color.toLowerCase() !== label.color.toLowerCase() || (found.description ?? '') !== label.description) {
      update.push({ ...label, current: found.name });
    }
  }
  return { create, update, unmanaged: [...current.values()].map((label) => label.name) };
}

export function applyLabelPlan(plan, send = ghSend) {
  for (const label of plan.create) {
    send('POST', 'repos/{owner}/{repo}/labels', { name: label.name, color: label.color, description: label.description });
  }
  for (const { current, ...label } of plan.update) {
    send('PATCH', `repos/{owner}/{repo}/labels/${encodeURIComponent(current)}`, { new_name: label.name, color: label.color, description: label.description });
  }
}

function describe(plan) {
  const lines = [
    ...plan.create.map((label) => `+ create  ${label.name}`),
    ...plan.update.map((label) => `~ update  ${label.current}${label.current === label.name ? '' : ` -> ${label.name}`}`),
    ...plan.unmanaged.map((name) => `? not in labels.json (left alone)  ${name}`),
  ];
  return lines.length ? lines.join('\n') : 'Labels are already in sync.';
}

function main() {
  const apply = process.argv.includes('--apply');
  const desired = JSON.parse(readFileSync(LABELS_FILE, 'utf8'));
  validateLabels(desired);
  const plan = planLabelSync(desired, ghList('repos/{owner}/{repo}/labels?per_page=100'));
  console.log(describe(plan));
  if (!apply) {
    console.log('\nDry run. Pass --apply to make these changes.');
    return;
  }
  applyLabelPlan(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
