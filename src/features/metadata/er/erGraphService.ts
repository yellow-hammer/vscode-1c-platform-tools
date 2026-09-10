/**
 * Загрузка ER-графа метаданных проекта через md-sparrow CLI ({@code cf-md-graph}) и его кэширование.
 *
 * Кэш по отпечатку исходного кода: см. {@link mdSparrowCache}.
 *
 * @module er/erGraphService
 */

import * as vscode from 'vscode';
import { logger } from '../../../shared/logger';
import { detectedSourceDirs } from '../../../shared/sourcePaths';
import { ensureMdSparrowRuntime } from '../mdSparrowBootstrap';
import { cacheFilePath, readCachedEntry, runtimeSalt, sourceFingerprint, writeCached } from '../mdSparrowCache';
import { isMdSparrowUnknownCommandError, MdSparrowOutdatedError } from '../mdSparrowErrors';
import { runMdSparrowParamsRead, supportEnabled } from '../mdSparrowParams';
import type { ErGraph, ErNode, ErEdge } from './erTypes';

const log = logger.scope('er');

export interface ErGraphLoadOptions {
	readonly progress?: vscode.Progress<{ message?: string; increment?: number }>;
	readonly token?: vscode.CancellationToken;
}

export interface ErGraphLoadResult {
	readonly graph: ErGraph;
	readonly fromCache: boolean;
	readonly fingerprint: string;
}

function isErGraph(value: unknown): value is ErGraph {
	const graph = value as Partial<ErGraph> | null;
	return graph !== null && typeof graph === 'object' && Array.isArray(graph.nodes) && Array.isArray(graph.edges);
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((it): it is string => typeof it === 'string');
}

function parseGraph(raw: string): ErGraph {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Ожидался JSON-объект графа.');
	}
	const nodes: ErNode[] = Array.isArray(parsed.nodes)
		? parsed.nodes.map((n) => {
				const o = (n ?? {}) as Record<string, unknown>;
				return {
					key: String(o.key ?? ''),
					objectType: String(o.objectType ?? ''),
					name: String(o.name ?? ''),
					synonym: String(o.synonym ?? ''),
					sourceId: String(o.sourceId ?? ''),
					relativePath: String(o.relativePath ?? ''),
					subsystemKeys: normalizeStringArray(o.subsystemKeys),
					partial: Boolean(o.partial),
				} satisfies ErNode;
			})
		: [];
	const edges: ErEdge[] = Array.isArray(parsed.edges)
		? parsed.edges.map((e) => {
				const o = (e ?? {}) as Record<string, unknown>;
				return {
					sourceKey: String(o.sourceKey ?? ''),
					targetKey: String(o.targetKey ?? ''),
					kind: String(o.kind ?? ''),
					cardinality: String(o.cardinality ?? '0..*'),
					via: normalizeStringArray(o.via),
				} satisfies ErEdge;
			})
		: [];
	const graph: ErGraph = {
		projectRoot: String(parsed.projectRoot ?? ''),
		mainSchemaVersion: String(parsed.mainSchemaVersion ?? ''),
		mainSchemaVersionFlag: String(parsed.mainSchemaVersionFlag ?? ''),
		nodeCount: typeof parsed.nodeCount === 'number' ? parsed.nodeCount : nodes.length,
		edgeCount: typeof parsed.edgeCount === 'number' ? parsed.edgeCount : edges.length,
		nodes,
		edges,
	};
	return graph;
}

/**
 * Загружает граф метаданных через md-sparrow с использованием кэша по контенту.
 */
export async function loadErGraph(
	context: vscode.ExtensionContext,
	workspaceRoot: string,
	options: ErGraphLoadOptions = {}
): Promise<ErGraphLoadResult> {
	const cacheFile = cacheFilePath(context, 'er-graph', workspaceRoot);
	const runtime = await ensureMdSparrowRuntime(context);
	const graphDirs = await detectedSourceDirs(workspaceRoot);
	const salt = async () => ['cf-md-graph', await runtimeSalt(runtime), `поддержка:${supportEnabled()}`, JSON.stringify(graphDirs)];
	const entry = await readCachedEntry(cacheFile, isErGraph);
	if (entry) {
		options.progress?.report({ message: 'ER: вычисление отпечатка проекта' });
		if ((await sourceFingerprint(workspaceRoot, await salt())) === entry.fingerprint) {
			log.debug(`кэш найден: ${cacheFile}`);
			return { graph: entry.payload, fromCache: true, fingerprint: entry.fingerprint };
		}
	}
	options.progress?.report({ message: 'ER: построение графа (md-sparrow cf-md-graph)' });
	const fingerprintPromise = salt().then((items) => sourceFingerprint(workspaceRoot, items));
	const res = await runMdSparrowParamsRead(
		runtime,
		{
			op: 'cf-md-graph',
			projectRoot: workspaceRoot,
			cfDir: graphDirs.cf,
			cfeDir: graphDirs.cfe,
			epfDir: graphDirs.epf,
			erfDir: graphDirs.erf,
			cfeDirs: graphDirs.cfeDirs,
			epfDirs: graphDirs.epfDirs,
			erfDirs: graphDirs.erfDirs,
		},
		{ cwd: workspaceRoot, token: options.token }
	);
	if (res.exitCode !== 0) {
		const errText = res.stderr.trim() || res.stdout.trim() || `код ${res.exitCode}`;
		if (isMdSparrowUnknownCommandError(res.stderr, res.stdout)) {
			throw new MdSparrowOutdatedError();
		}
		throw new Error(`md-sparrow cf-md-graph: ${errText}`);
	}
	const stdout = res.stdout.trim();
	if (!stdout.startsWith('{')) {
		throw new Error(`Ожидался JSON-граф, получено: ${stdout.slice(0, 200)}`);
	}
	let graph: ErGraph;
	try {
		graph = parseGraph(stdout);
	} catch (e) {
		throw new Error(`Не удалось разобрать JSON графа: ${e instanceof Error ? e.message : String(e)}`);
	}
	const fingerprint = await fingerprintPromise;
	await writeCached(cacheFile, fingerprint, graph);
	return { graph, fromCache: false, fingerprint };
}
