'use strict';
// Node writers (l0-ingest / l1-daily / l1-facts / l2-promote) must go through this gate.
// Same contract as scripts/p-knowledge-base/schema.yml + kb-check.py.

const VISIBILITY = new Set(['self', 'dept', 'company', 'boss']);
const EVIDENCE = new Set(['none', 'observed', 'sourced', 'accepted']);
const ADOPT = new Set(['candidate', 'adopted', 'superseded']);

function missing(fm, key) {
	return !fm || String(fm[key] || '').trim() === '';
}

function validateFrontmatter(fm, layer) {
	const errors = [];
	if (missing(fm, 'owner')) errors.push('no-owner');
	if (missing(fm, 'dept')) errors.push('no-dept');
	if (missing(fm, 'visibility') || !VISIBILITY.has(String(fm.visibility))) errors.push('no-visibility');
	if (layer === 'l0') {
		if (missing(fm, 'evidence_level') || !EVIDENCE.has(String(fm.evidence_level))) errors.push('no-evidence');
	} else if (fm.evidence_level && !EVIDENCE.has(String(fm.evidence_level))) {
		errors.push('no-evidence');
	}
	if (fm.adopt_status && !ADOPT.has(String(fm.adopt_status))) errors.push('bad-adopt');
	if (layer === 'l2' && (missing(fm, 'backlink_l1') || missing(fm, 'backlink_l0'))) {
		errors.push('no-backlink');
	}
	return errors;
}

function renderFrontmatter(fm) {
	const keys = Object.keys(fm);
	const lines = ['---'];
	for (const k of keys) {
		if (fm[k] == null || fm[k] === '') continue;
		lines.push(k + ': ' + String(fm[k]));
	}
	lines.push('---');
	return lines.join('\n');
}

function assertNote(fm, layer) {
	const errors = validateFrontmatter(fm, layer);
	if (errors.length) throw new Error('schema-gate:' + errors.join(','));
}

module.exports = { validateFrontmatter, renderFrontmatter, assertNote };
