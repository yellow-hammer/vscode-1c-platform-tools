/**
 * Модель пайплайна: граф шагов со связями.
 *
 * Узел - действие (команда расширения, команда оболочки, пауза с
 * подтверждением), связь - переход между узлами по исходу предыдущего:
 * успех, ошибка или в любом случае. Граф хранится в `.1cpt/pipelines.json`,
 * файл остаётся источником истины и правится и визуальным редактором, и руками.
 */

/** Что делает узел */
export type PipelineNodeType = 'command' | 'shell' | 'confirm';

/** Узел графа */
export interface PipelineNode {
	/** Идентификатор узла, уникальный в пределах пайплайна */
	id: string;
	/** Тип действия */
	type: PipelineNodeType;
	/** Подпись; пустая - берётся из действия */
	name?: string;
	/** Идентификатор команды расширения (type: command) */
	command?: string;
	/** Параметры вызова команды (type: command) */
	options?: Record<string, unknown>;
	/** Командная строка (type: shell) */
	script?: string;
	/** Текст вопроса (type: confirm) */
	message?: string;
	/** Ограничение времени в секундах */
	timeout?: number;
	/** Сколько раз повторить упавший шаг перед тем, как считать его ошибкой */
	retry?: number;
	/** Узел выключен: пропускается, переходы идут дальше как при успехе */
	enabled?: boolean;
	/** Ждать все входящие ветки, а не первую пришедшую */
	join?: 'all';
	/** Положение на полотне */
	x?: number;
	y?: number;
}

/** По какому исходу срабатывает связь */
export type PipelineEdgeCondition = 'success' | 'error' | 'always';

/** Связь между узлами */
export interface PipelineEdge {
	from: string;
	to: string;
	/** Условие перехода; по умолчанию success */
	on?: PipelineEdgeCondition;
}

/** Пайплайн: граф узлов и связей */
export interface Pipeline {
	/** Стабильный идентификатор для запуска из команды и агентом */
	id: string;
	/** Название для дерева и редактора */
	name: string;
	/** Пояснение к назначению цепочки */
	description?: string;
	/** Параметры цепочки: подставляются в шаги как {{имя}} */
	params?: Record<string, string>;
	/** Узлы графа */
	nodes: PipelineNode[];
	/** Связи между узлами */
	edges: PipelineEdge[];
}

/** Содержимое `.1cpt/pipelines.json` */
export interface PipelinesFile {
	version?: number;
	pipelines: Pipeline[];
}

/** Текущая версия формата файла */
export const PIPELINES_FILE_VERSION = 2;

/** Путь файла относительно корня проекта */
export const PIPELINES_FILE_REL_PATH = '.1cpt/pipelines.json';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeNode(raw: unknown, index: number): PipelineNode | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const command = readString(raw.command);
	const script = readString(raw.script);
	const declared = readString(raw.type);
	const type: PipelineNodeType =
		declared === 'shell' || declared === 'confirm' || declared === 'command'
			? declared
			: script !== undefined ? 'shell' : 'command';

	// Незаполненный блок сохраняется как есть: пользователь мог поставить его на
	// полотно и уйти. О том, что действие не задано, скажет проверка перед запуском
	const node: PipelineNode = { id: readString(raw.id) ?? `n${index + 1}`, type };
	const name = readString(raw.name);
	if (name !== undefined) {
		node.name = name;
	}
	if (type === 'command') {
		node.command = command ?? '';
		if (isRecord(raw.options) && Object.keys(raw.options).length > 0) {
			node.options = raw.options;
		}
	}
	if (type === 'shell') {
		node.script = script ?? '';
	}
	const timeout = readNumber(raw.timeout);
	if (timeout !== undefined && timeout > 0) {
		node.timeout = timeout;
	}
	const retry = readNumber(raw.retry);
	if (retry !== undefined && retry > 0) {
		node.retry = Math.floor(retry);
	}
	if (type === 'confirm') {
		node.message = readString(raw.message) ?? 'Продолжить выполнение пайплайна?';
	}
	if (raw.enabled === false) {
		node.enabled = false;
	}
	if (raw.join === 'all') {
		node.join = 'all';
	}
	const x = readNumber(raw.x);
	const y = readNumber(raw.y);
	if (x !== undefined) {
		node.x = x;
	}
	if (y !== undefined) {
		node.y = y;
	}
	return node;
}

function normalizeEdge(raw: unknown, nodeIds: Set<string>): PipelineEdge | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const from = readString(raw.from);
	const to = readString(raw.to);
	if (from === undefined || to === undefined || from === to) {
		return undefined;
	}
	// Связь в никуда осталась бы от удалённого узла и ломала обход
	if (!nodeIds.has(from) || !nodeIds.has(to)) {
		return undefined;
	}
	const edge: PipelineEdge = { from, to };
	if (raw.on === 'error' || raw.on === 'always') {
		edge.on = raw.on;
	}
	return edge;
}

function normalizePipeline(raw: unknown, index: number): Pipeline | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const id = readString(raw.id) ?? `pipeline-${index + 1}`;
	const name = readString(raw.name) ?? id;

	const nodes: PipelineNode[] = [];
	const usedIds = new Set<string>();
	const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
	for (const [nodeIndex, rawNode] of rawNodes.entries()) {
		const node = normalizeNode(rawNode, nodeIndex);
		if (!node) {
			continue;
		}
		let nodeId = node.id;
		let suffix = 2;
		while (usedIds.has(nodeId)) {
			nodeId = `${node.id}-${suffix}`;
			suffix += 1;
		}
		usedIds.add(nodeId);
		nodes.push({ ...node, id: nodeId });
	}

	const seenEdges = new Set<string>();
	const edges: PipelineEdge[] = [];
	for (const rawEdge of Array.isArray(raw.edges) ? raw.edges : []) {
		const edge = normalizeEdge(rawEdge, usedIds);
		if (!edge) {
			continue;
		}
		const key = `${edge.from}>${edge.to}:${edge.on ?? 'success'}`;
		if (seenEdges.has(key)) {
			continue;
		}
		seenEdges.add(key);
		edges.push(edge);
	}

	const pipeline: Pipeline = { id, name, nodes, edges };
	const description = readString(raw.description);
	if (description !== undefined) {
		pipeline.description = description;
	}
	if (isRecord(raw.params)) {
		const params: Record<string, string> = {};
		for (const [key, value] of Object.entries(raw.params)) {
			if (key.trim() !== '' && (typeof value === 'string' || typeof value === 'number')) {
				params[key.trim()] = String(value);
			}
		}
		if (Object.keys(params).length > 0) {
			pipeline.params = params;
		}
	}
	return pipeline;
}

/**
 * Разбирает содержимое файла пайплайнов.
 *
 * Битые записи отбрасываются, а не роняют разбор: файл редактируется руками,
 * и один кривой узел не должен прятать остальные цепочки.
 *
 * @param raw - Разобранный JSON файла
 * @returns Список пайплайнов с уникальными идентификаторами
 */
export function normalizePipelines(raw: unknown): Pipeline[] {
	const source = isRecord(raw) && Array.isArray(raw.pipelines) ? raw.pipelines : [];
	const pipelines: Pipeline[] = [];
	const used = new Set<string>();
	for (const [index, item] of source.entries()) {
		const pipeline = normalizePipeline(item, index);
		if (!pipeline) {
			continue;
		}
		let id = pipeline.id;
		let suffix = 2;
		while (used.has(id)) {
			id = `${pipeline.id}-${suffix}`;
			suffix += 1;
		}
		used.add(id);
		pipelines.push({ ...pipeline, id });
	}
	return pipelines;
}

/**
 * Узлы, с которых начинается прогон: без входящих связей.
 *
 * @param pipeline - Пайплайн
 * @returns Узлы в порядке объявления
 */
export function startNodes(pipeline: Pipeline): PipelineNode[] {
	const targets = new Set(pipeline.edges.map((edge) => edge.to));
	return pipeline.nodes.filter((node) => !targets.has(node.id));
}

/**
 * Подпись узла для отчёта и полотна.
 *
 * @param node - Узел
 * @param titleForCommand - Заголовок команды по идентификатору
 * @returns Подпись узла
 */
export function nodeLabel(
	node: PipelineNode,
	titleForCommand?: (commandId: string) => string | undefined
): string {
	if (node.name !== undefined) {
		return node.name;
	}
	if (node.type === 'shell') {
		return node.script ?? 'Команда оболочки';
	}
	if (node.type === 'confirm') {
		return node.message ?? 'Подтверждение';
	}
	return (node.command !== undefined ? titleForCommand?.(node.command) : undefined) ?? node.command ?? 'Команда';
}

/**
 * Склоняет слово «шаг» по количеству: подпись цепочки в дереве и списках.
 *
 * @param count - Количество шагов
 * @returns Слово в нужной форме
 */
export function stepsWord(count: number): string {
	const tail = count % 100;
	if (tail >= 11 && tail <= 14) {
		return 'шагов';
	}
	switch (count % 10) {
		case 1: return 'шаг';
		case 2:
		case 3:
		case 4: return 'шага';
		default: return 'шагов';
	}
}

/**
 * Подставляет параметры цепочки в текст: `{{имя}}` заменяется значением.
 *
 * Неизвестное имя остаётся как есть: так опечатка видна в выводе шага, а не
 * превращается в пустую строку.
 *
 * @param text - Строка с подстановками
 * @param params - Параметры цепочки
 * @returns Строка с подставленными значениями
 */
export function applyParams(text: string, params?: Record<string, string>): string {
	if (!params || text === '') {
		return text;
	}
	return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
		Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match
	);
}

/**
 * Подставляет параметры во всё, что уходит в исполнение узла.
 *
 * @param node - Узел графа
 * @param params - Параметры цепочки
 * @returns Копия узла с подставленными значениями
 */
export function resolveNodeParams(node: PipelineNode, params?: Record<string, string>): PipelineNode {
	if (!params) {
		return node;
	}
	const resolved: PipelineNode = { ...node };
	if (resolved.script !== undefined) {
		resolved.script = applyParams(resolved.script, params);
	}
	if (resolved.message !== undefined) {
		resolved.message = applyParams(resolved.message, params);
	}
	if (resolved.options !== undefined) {
		resolved.options = Object.fromEntries(
			Object.entries(resolved.options).map(([key, value]) => [
				key,
				typeof value === 'string' ? applyParams(value, params) : value,
			])
		);
	}
	return resolved;
}
