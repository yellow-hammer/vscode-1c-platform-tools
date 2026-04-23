/**
 * Стили Cytoscape для ER-canvas.
 *
 * @module webviews/metadataErCanvas/style
 */

import type { StylesheetJson } from 'cytoscape';

export function buildCytoscapeStyle(): StylesheetJson {
	return [
		// ── Базовый узел ────────────────────────────────────────────────────
		{
			selector: 'node.md',
			style: {
				'background-color': 'var(--vscode-editorWidget-background, #252526)',
				'border-color': 'var(--vscode-focusBorder, #007fd4)',
				'border-width': 1,
				'shape': 'round-rectangle',
				'label': 'data(label)',
				'color': 'var(--vscode-editor-foreground, #d4d4d4)',
				'text-wrap': 'wrap',
				'text-max-width': '200px',
				'text-valign': 'center',
				'text-halign': 'center',
				'font-size': 11,
				'font-family': 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
				'padding': '10px',
				'width': 'label',
				'height': 'label',
				'min-width': 80,
				'min-height': 40,
			},
		},
		// ── Типовые цвета ──────────────────────────────────────────────────
		{
			selector: 'node.md.type-catalog',
			style: { 'background-color': '#1a3a5c', 'border-color': '#4a8cbf' },
		},
		{
			selector: 'node.md.type-document',
			style: { 'background-color': '#5c1a1a', 'border-color': '#bf4a4a' },
		},
		{
			selector: 'node.md.type-informationregister',
			style: { 'background-color': '#1a4a2a', 'border-color': '#4abf6a' },
		},
		{
			selector: 'node.md.type-accumulationregister',
			style: { 'background-color': '#1a4a2a', 'border-color': '#4abf6a' },
		},
		{
			selector: 'node.md.type-accountingregister',
			style: { 'background-color': '#1a4a2a', 'border-color': '#6abf4a' },
		},
		{
			selector: 'node.md.type-calculationregister',
			style: { 'background-color': '#1a4a2a', 'border-color': '#8abf4a' },
		},
		{
			selector: 'node.md.type-enum',
			style: { 'background-color': '#3a3a1a', 'border-color': '#bfbf4a' },
		},
		{
			selector: 'node.md.type-chartofcharacteristictypes',
			style: { 'background-color': '#3a1a4a', 'border-color': '#8a4abf' },
		},
		{
			selector: 'node.md.type-chartofaccounts',
			style: { 'background-color': '#3a1a4a', 'border-color': '#bf4a8a' },
		},
		{
			selector: 'node.md.type-chartofcalculationtypes',
			style: { 'background-color': '#3a1a4a', 'border-color': '#bf6a4a' },
		},
		{
			selector: 'node.md.type-exchangeplan',
			style: { 'background-color': '#1a3a4a', 'border-color': '#4abfbf' },
		},
		{
			selector: 'node.md.type-filtercriterion',
			style: { 'background-color': '#4a3a1a', 'border-color': '#bf8a4a' },
		},
		{
			selector: 'node.md.type-functionaloption',
			style: { 'background-color': '#4a1a4a', 'border-color': '#bf4abf' },
		},
		{
			selector: 'node.md.type-functionaloptionsparameter',
			style: { 'background-color': '#4a1a3a', 'border-color': '#bf4a8a' },
		},
		{
			selector: 'node.md.type-subsystem',
			style: {
				'background-color': '#2a2a2a',
				'border-color': '#888888',
				'border-style': 'dashed',
				'font-style': 'italic',
			},
		},
		{
			selector: 'node.md.type-role',
			style: { 'background-color': '#4a4a1a', 'border-color': '#c5a64f' },
		},
		{
			selector: 'node.md.type-commonattribute',
			style: { 'background-color': '#2a3a4a', 'border-color': '#6a8abf' },
		},
		{
			selector: 'node.md.type-businessprocess, node.md.type-task',
			style: { 'background-color': '#1a4a4a', 'border-color': '#4abfbf' },
		},
		{
			selector: 'node.md.type-constant, node.md.type-definedtype, node.md.type-sessionparameter',
			style: { 'background-color': '#2a2a3a', 'border-color': '#7a7abf' },
		},
		{
			selector: 'node.md.type-sequence, node.md.type-documentjournal',
			style: { 'background-color': '#3a2a1a', 'border-color': '#bf9a4a' },
		},
		{
			selector: 'node.md.type-report',
			style: { 'background-color': '#3a2410', 'border-color': '#c0703a' },
		},
		{
			selector: 'node.md.type-dataprocessor',
			style: { 'background-color': '#3a2c14', 'border-color': '#c08040' },
		},
		{
			selector: 'node.md.type-eventsubscription',
			style: { 'background-color': '#103a3a', 'border-color': '#30b0a0' },
		},
		{
			selector: 'node.md.type-scheduledjob',
			style: { 'background-color': '#143a2a', 'border-color': '#30b070' },
		},
		{
			selector: 'node.md.type-commoncommand',
			style: { 'background-color': '#202040', 'border-color': '#5050c0' },
		},
		// ── Неполный объект (partial) ──────────────────────────────────────
		{
			selector: 'node.md.partial',
			style: { 'border-style': 'dashed', 'opacity': 0.8 },
		},
		// ── Seed-узел (начальный объект схемы) ─────────────────────────────
		{
			selector: 'node.md.seed',
			style: {
				'border-color': 'var(--vscode-charts-yellow, #e8c447)',
				'border-width': 2,
				'border-style': 'solid',
			},
		},
		// ── Выбранный узел ─────────────────────────────────────────────────
		{
			selector: 'node:selected',
			style: {
				'border-color': 'var(--vscode-charts-orange, #ce9178)',
				'border-width': 3,
				'border-style': 'solid',
			},
		},
		// ── Базовое ребро ──────────────────────────────────────────────────
		{
			selector: 'edge',
			style: {
				'curve-style': 'bezier',
				'target-arrow-shape': 'triangle',
				'arrow-scale': 1,
				'line-color': '#555555',
				'target-arrow-color': '#555555',
				'width': 1.5,
				'label': 'data(label)',
				'font-size': 9,
				'font-family': 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
				'color': '#999999',
				'text-background-color': 'var(--vscode-editor-background, #1e1e1e)',
				'text-background-opacity': 0.9,
				'text-background-padding': '2px',
				'text-rotation': 'none',
				'text-wrap': 'wrap',
				'text-max-width': '180px',
			},
		},
		// ── Виды связей ───────────────────────────────────────────────────
		{
			selector: 'edge.subsystemMembership, edge.subsystemNesting',
			style: {
				'line-color': '#666666',
				'target-arrow-color': '#666666',
				'line-style': 'dashed',
				'width': 1,
			},
		},
		{
			selector: 'edge.typeComposite, edge.registerDimensionType, edge.registerResourceType',
			style: {
				'line-color': '#4a8cbf',
				'target-arrow-color': '#4a8cbf',
				'width': 2,
			},
		},
		{
			selector: 'edge.catalogOwners',
			style: {
				'line-color': '#bf4a4a',
				'target-arrow-color': '#bf4a4a',
				'target-arrow-shape': 'tee',
			},
		},
		{
			selector: 'edge.documentPostingRegisters',
			style: {
				'line-color': '#4abf6a',
				'target-arrow-color': '#4abf6a',
				'target-arrow-shape': 'circle',
			},
		},
		{
			selector: 'edge.documentBasedOn',
			style: {
				'line-color': '#bf6060',
				'target-arrow-color': '#bf6060',
				'line-style': 'dashed',
			},
		},
		{
			selector: 'edge.documentJournalEntries',
			style: {
				'line-color': '#bf9a4a',
				'target-arrow-color': '#bf9a4a',
			},
		},
		{
			selector: 'edge.sequenceDocuments, edge.sequenceRegisters',
			style: {
				'line-color': '#bf8040',
				'target-arrow-color': '#bf8040',
			},
		},
		{
			selector: 'edge.filterCriterionType, edge.filterCriterionContent',
			style: {
				'line-color': '#8a9a40',
				'target-arrow-color': '#8a9a40',
			},
		},
		{
			selector: 'edge.commandParameterType',
			style: {
				'line-color': '#5070bf',
				'target-arrow-color': '#5070bf',
			},
		},
		{
			selector: 'edge.subscriptionSource, edge.subscriptionHandler',
			style: {
				'line-color': '#30a0a0',
				'target-arrow-color': '#30a0a0',
			},
		},
		{
			selector: 'edge.scheduledJobHandler',
			style: {
				'line-color': '#30b070',
				'target-arrow-color': '#30b070',
				'line-style': 'dashed',
			},
		},
		{
			selector: 'edge.registerChartOfAccounts, edge.registerChartOfCalculationTypes',
			style: {
				'line-color': '#b07040',
				'target-arrow-color': '#b07040',
			},
		},
		{
			selector: 'edge.chartOfAccountsExtDimensions, edge.characteristicExtValues',
			style: {
				'line-color': '#8060bf',
				'target-arrow-color': '#8060bf',
			},
		},
		{
			selector: 'edge.roleObjectRights',
			style: {
				'line-color': '#c5a64f',
				'target-arrow-color': '#c5a64f',
				'line-style': 'dotted',
				'width': 1,
			},
		},
		{
			selector: 'edge.functionalOptionLocation, edge.functionalOptionAffected, edge.fopUseBinding',
			style: {
				'line-color': '#a36ec5',
				'target-arrow-color': '#a36ec5',
			},
		},
		{
			selector: 'edge.commonAttributeUsage',
			style: {
				'line-color': '#6a8abf',
				'target-arrow-color': '#6a8abf',
				'line-style': 'dashed',
			},
		},
		{
			selector: 'edge.exchangePlanContent',
			style: {
				'line-color': '#4abfbf',
				'target-arrow-color': '#4abfbf',
			},
		},
		{
			selector: 'edge:selected',
			style: {
				'line-color': 'var(--vscode-charts-orange, #ce9178)',
				'target-arrow-color': 'var(--vscode-charts-orange, #ce9178)',
				'width': 3,
			},
		},
		// ── Подсветка соседства ────────────────────────────────────────────
		{
			selector: '.dimmed',
			style: { 'opacity': 0.12 },
		},
		{
			selector: '.highlighted',
			style: { 'opacity': 1 },
		},
	] as unknown as StylesheetJson;
}
