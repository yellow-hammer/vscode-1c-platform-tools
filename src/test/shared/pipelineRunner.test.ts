import * as assert from 'node:assert';
import {
	runPipeline,
	formatRunSummary,
	validatePipeline,
	NodeExecutionResult,
} from '../../shared/pipelines/pipelineRunner';
import { nodeLabel, Pipeline, PipelineEdge, PipelineNode } from '../../shared/pipelines/pipelineTypes';

/** Узел-команда с идентификатором вместо подписи. */
function node(id: string, extra: Partial<PipelineNode> = {}): PipelineNode {
	return { id, type: 'command', command: id, name: id, ...extra };
}

/** Граф из узлов и связей. */
function graph(nodes: PipelineNode[], edges: PipelineEdge[] = []): Pipeline {
	return { id: 'p', name: 'Цепочка', nodes, edges };
}

/** Исполнитель, который возвращает исход по идентификатору узла. */
function executor(
	outcomes: Record<string, NodeExecutionResult>,
	calls: string[] = []
): (node: PipelineNode) => Promise<NodeExecutionResult> {
	return async (item) => {
		calls.push(item.id);
		return outcomes[item.id] ?? { success: true };
	};
}

suite('прогон пайплайна: линейная цепочка', () => {
	test('узлы идут по связям, а не по порядку объявления', async () => {
		const calls: string[] = [];
		const result = await runPipeline(
			graph([node('c'), node('a'), node('b')], [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'c' },
			]),
			executor({}, calls)
		);
		assert.deepStrictEqual(calls, ['a', 'b', 'c']);
		assert.strictEqual(result.success, true);
	});

	test('ошибка без ветки обрыва останавливает цепочку', async () => {
		const calls: string[] = [];
		const result = await runPipeline(
			graph([node('a'), node('b'), node('c')], [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'c' },
			]),
			executor({ b: { success: false, exitCode: 1, message: 'упало' } }, calls)
		);
		assert.deepStrictEqual(calls, ['a', 'b']);
		assert.strictEqual(result.success, false);
		assert.deepStrictEqual(
			result.nodes.map((item) => `${item.nodeId}:${item.status}`),
			['a:ok', 'b:failed', 'c:notRun']
		);
	});

	test('выключенный узел пропускается, но ветка успеха идёт дальше', async () => {
		const calls: string[] = [];
		const result = await runPipeline(
			graph([node('a', { enabled: false }), node('b')], [{ from: 'a', to: 'b' }]),
			executor({}, calls)
		);
		assert.deepStrictEqual(calls, ['b']);
		assert.strictEqual(result.nodes[0].status, 'skipped');
		assert.strictEqual(result.success, true);
	});

	test('исключение исполнителя становится ошибкой узла', async () => {
		const result = await runPipeline(graph([node('a')]), async () => {
			throw new Error('команда не зарегистрирована');
		});
		assert.strictEqual(result.nodes[0].status, 'failed');
		assert.strictEqual(result.nodes[0].message, 'команда не зарегистрирована');
	});

	test('отмена прекращает прогон перед следующим узлом', async () => {
		const calls: string[] = [];
		let cancelled = false;
		const result = await runPipeline(
			graph([node('a'), node('b')], [{ from: 'a', to: 'b' }]),
			async (item) => {
				calls.push(item.id);
				cancelled = true;
				return { success: true };
			},
			{ isCancelled: () => cancelled }
		);
		assert.deepStrictEqual(calls, ['a']);
		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.success, false);
	});
});

suite('прогон пайплайна: ветвление', () => {
	test('ветка error идёт только при падении', async () => {
		const calls: string[] = [];
		const pipeline = graph([node('build'), node('deploy'), node('report')], [
			{ from: 'build', to: 'deploy', on: 'success' },
			{ from: 'build', to: 'report', on: 'error' },
		]);

		await runPipeline(pipeline, executor({}, calls));
		assert.deepStrictEqual(calls, ['build', 'deploy'], 'при успехе ветка ошибки не срабатывает');

		const failedCalls: string[] = [];
		const result = await runPipeline(
			pipeline,
			executor({ build: { success: false, message: 'сборка упала' } }, failedCalls)
		);
		assert.deepStrictEqual(failedCalls, ['build', 'report']);
		assert.strictEqual(result.success, false, 'обработанное падение не делает прогон успешным');
	});

	test('ветка always идёт при любом исходе', async () => {
		const calls: string[] = [];
		await runPipeline(
			graph([node('tests'), node('cleanup')], [{ from: 'tests', to: 'cleanup', on: 'always' }]),
			executor({ tests: { success: false } }, calls)
		);
		assert.deepStrictEqual(calls, ['tests', 'cleanup']);
	});

	test('параллельные ветки выполняются обе и сходятся в общий узел', async () => {
		const calls: string[] = [];
		await runPipeline(
			graph([node('start'), node('left'), node('right'), node('end')], [
				{ from: 'start', to: 'left' },
				{ from: 'start', to: 'right' },
				{ from: 'left', to: 'end' },
				{ from: 'right', to: 'end' },
			]),
			executor({}, calls)
		);
		assert.deepStrictEqual(calls, ['start', 'left', 'right', 'end']);
	});

	test('join: all ждёт все ветки, без него узел идёт по первой', async () => {
		const early: string[] = [];
		await runPipeline(
			graph([node('start'), node('left'), node('right'), node('end')], [
				{ from: 'start', to: 'left' },
				{ from: 'start', to: 'right' },
				{ from: 'left', to: 'end' },
				{ from: 'right', to: 'end' },
			]),
			executor({}, early)
		);
		// end объявлен последним, поэтому порядок совпадает; проверяем сам факт ожидания
		const waiting: string[] = [];
		await runPipeline(
			graph([node('start'), node('left'), node('end', { join: 'all' }), node('right')], [
				{ from: 'start', to: 'left' },
				{ from: 'start', to: 'right' },
				{ from: 'left', to: 'end' },
				{ from: 'right', to: 'end' },
			]),
			executor({}, waiting)
		);
		assert.deepStrictEqual(waiting, ['start', 'left', 'right', 'end']);

		const withoutJoin: string[] = [];
		await runPipeline(
			graph([node('start'), node('left'), node('end'), node('right')], [
				{ from: 'start', to: 'left' },
				{ from: 'start', to: 'right' },
				{ from: 'left', to: 'end' },
				{ from: 'right', to: 'end' },
			]),
			executor({}, withoutJoin)
		);
		assert.deepStrictEqual(withoutJoin, ['start', 'left', 'end', 'right']);
	});

	test('узел с join: all не ждёт ветку, которая уже не сработает', async () => {
		const calls: string[] = [];
		await runPipeline(
			graph([node('start'), node('other'), node('end', { join: 'all' })], [
				{ from: 'start', to: 'end' },
				{ from: 'start', to: 'other', on: 'error' },
				{ from: 'other', to: 'end' },
			]),
			executor({}, calls)
		);
		assert.deepStrictEqual(calls, ['start', 'end']);
	});
});

suite('проверка графа', () => {
	test('пустой граф и граф без начала', () => {
		assert.deepStrictEqual(validatePipeline(graph([])), ['в пайплайне нет ни одного шага']);
		const problems = validatePipeline(
			graph([node('a'), node('b')], [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'a' },
			])
		);
		assert.ok(problems.some((problem) => problem.includes('нет начального шага')), problems.join('; '));
	});

	test('недостижимый узел виден до запуска', () => {
		const problems = validatePipeline(
			graph([node('a'), node('b'), node('loop1'), node('loop2')], [
				{ from: 'a', to: 'b' },
				{ from: 'loop1', to: 'loop2' },
				{ from: 'loop2', to: 'loop1' },
			])
		);
		assert.ok(problems.some((problem) => problem.includes('нет пути')), problems.join('; '));
	});

	test('исправный граф замечаний не даёт', () => {
		assert.deepStrictEqual(validatePipeline(graph([node('a'), node('b')], [{ from: 'a', to: 'b' }])), []);
	});
});

suite('подписи и сводка', () => {
	test('подпись узла: своя, затем действие', () => {
		const title = (id: string): string | undefined => (id === 'known' ? 'Известная' : undefined);
		assert.strictEqual(nodeLabel({ id: 'n', type: 'command', command: 'known', name: 'Своя' }, title), 'Своя');
		assert.strictEqual(nodeLabel({ id: 'n', type: 'command', command: 'known' }, title), 'Известная');
		assert.strictEqual(nodeLabel({ id: 'n', type: 'command', command: 'other' }, title), 'other');
		assert.strictEqual(nodeLabel({ id: 'n', type: 'shell', script: 'git status' }), 'git status');
		assert.strictEqual(nodeLabel({ id: 'n', type: 'confirm', message: 'Готово?' }), 'Готово?');
	});

	test('сводка перечисляет выполненные узлы и не дошедшие', async () => {
		const result = await runPipeline(
			graph([node('a'), node('b'), node('c')], [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'c' },
			]),
			executor({ b: { success: false, message: 'код возврата 1' } })
		);
		const summary = formatRunSummary(result);
		assert.ok(summary.includes('завершился с ошибкой'), summary);
		assert.ok(summary.includes('1. a - выполнен'), summary);
		assert.ok(summary.includes('2. b - ошибка: код возврата 1'), summary);
		assert.ok(summary.includes('не выполнялись: c'), summary);
	});
});

suite('проверка графа: незаполненные блоки', () => {
	test('блок без действия виден до запуска', () => {
		const problems = validatePipeline({
			id: 'p',
			name: 'Ц',
			nodes: [
				{ id: 'a', type: 'command', command: '' },
				{ id: 'b', type: 'shell', script: '   ', name: 'Скрипт' },
			],
			edges: [{ from: 'a', to: 'b' }],
		});
		assert.ok(problems.some((problem) => problem.includes('не задано действие')), problems.join('; '));
		assert.ok(problems.some((problem) => problem.includes('Скрипт')), problems.join('; '));
	});

	test('выключенный блок без действия претензий не вызывает', () => {
		const problems = validatePipeline({
			id: 'p',
			name: 'Ц',
			nodes: [
				{ id: 'a', type: 'command', command: '1c-platform-tools.test.xunit' },
				{ id: 'b', type: 'shell', script: '', enabled: false },
			],
			edges: [{ from: 'a', to: 'b' }],
		});
		assert.deepStrictEqual(problems, []);
	});
});

suite('параметры и повтор', () => {
	test('параметры подставляются в строку оболочки, вопрос и параметры вызова', async () => {
		const seen: Array<Record<string, unknown>> = [];
		await runPipeline(
			{
				id: 'p',
				name: 'Ц',
				params: { profile: 'test', branch: 'main' },
				nodes: [
					{ id: 'a', type: 'shell', script: 'git checkout {{branch}}' },
					{ id: 'b', type: 'confirm', message: 'Ставим профиль {{profile}}?' },
					{ id: 'c', type: 'command', command: 'x', options: { settingsFile: 'env.{{profile}}.json', wait: true } },
				],
				edges: [
					{ from: 'a', to: 'b' },
					{ from: 'b', to: 'c' },
				],
			},
			async (node) => {
				seen.push({ script: node.script, message: node.message, options: node.options });
				return { success: true };
			}
		);
		assert.strictEqual(seen[0].script, 'git checkout main');
		assert.strictEqual(seen[1].message, 'Ставим профиль test?');
		assert.deepStrictEqual(seen[2].options, { settingsFile: 'env.test.json', wait: true });
	});

	test('неизвестный параметр остаётся в тексте: опечатку видно', async () => {
		const seen: string[] = [];
		await runPipeline(
			{ id: 'p', name: 'Ц', params: { a: '1' }, nodes: [{ id: 'n', type: 'shell', script: 'echo {{b}}' }], edges: [] },
			async (node) => {
				seen.push(node.script ?? '');
				return { success: true };
			}
		);
		assert.deepStrictEqual(seen, ['echo {{b}}']);
	});

	test('повтор перезапускает упавший шаг и отмечает число попыток', async () => {
		let calls = 0;
		const result = await runPipeline(
			{ id: 'p', name: 'Ц', nodes: [{ id: 'n', type: 'shell', script: 'x', retry: 2 }], edges: [] },
			async () => {
				calls += 1;
				return calls < 3 ? { success: false, message: 'сеть' } : { success: true };
			}
		);
		assert.strictEqual(calls, 3, 'две повторные попытки после первой');
		assert.strictEqual(result.nodes[0].status, 'ok');
		assert.strictEqual(result.nodes[0].attempts, 3);
		assert.strictEqual(result.success, true);
	});

	test('повтор не бесконечен: после исчерпания попыток шаг падает', async () => {
		let calls = 0;
		const result = await runPipeline(
			{ id: 'p', name: 'Ц', nodes: [{ id: 'n', type: 'shell', script: 'x', retry: 1 }], edges: [] },
			async () => {
				calls += 1;
				return { success: false, message: 'всё плохо' };
			}
		);
		assert.strictEqual(calls, 2);
		assert.strictEqual(result.nodes[0].status, 'failed');
		assert.strictEqual(result.nodes[0].message, 'всё плохо');
	});
});
