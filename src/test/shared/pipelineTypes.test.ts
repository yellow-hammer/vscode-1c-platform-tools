import * as assert from 'node:assert';
import {
	EDITOR_SELECTION,
	editorLaunchUse,
	missingLaunchReferences,
	nodeLaunchSelection,
	normalizePipelines,
	startNodes,
	stepsWord,
} from '../../shared/pipelines/pipelineTypes';
import { serializePipelines } from '../../shared/pipelines/pipelineFile';

suite('разбор файла пайплайнов', () => {
	test('читает граф со всеми видами узлов', () => {
		const pipelines = normalizePipelines({
			version: 2,
			pipelines: [
				{
					id: 'nightly',
					name: 'Ночная сборка',
					description: 'загрузка и тесты',
					nodes: [
						{
							id: 'load',
							type: 'command',
							command: '1c-platform-tools.cf.load',
							name: 'Загрузить',
							options: { settingsFile: 'env.test.json' },
							x: 100,
							y: 40,
						},
						{ id: 'git', type: 'shell', script: 'git status', timeout: 30 },
						{ id: 'ask', type: 'confirm', message: 'Продолжаем?', enabled: false, join: 'all' },
					],
					edges: [
						{ from: 'load', to: 'git' },
						{ from: 'load', to: 'ask', on: 'error' },
					],
				},
			],
		});

		assert.strictEqual(pipelines.length, 1);
		assert.deepStrictEqual(pipelines[0].nodes, [
			{
				id: 'load',
				type: 'command',
				name: 'Загрузить',
				command: '1c-platform-tools.cf.load',
				options: { settingsFile: 'env.test.json' },
				x: 100,
				y: 40,
			},
			{ id: 'git', type: 'shell', script: 'git status', timeout: 30 },
			{ id: 'ask', type: 'confirm', message: 'Продолжаем?', enabled: false, join: 'all' },
		]);
		assert.deepStrictEqual(pipelines[0].edges, [
			{ from: 'load', to: 'git' },
			{ from: 'load', to: 'ask', on: 'error' },
		]);
	});

	test('незаполненный узел сохраняется: правки не теряются', () => {
		const pipelines = normalizePipelines({
			pipelines: [
				{
					id: 'p',
					name: 'П',
					nodes: [{ id: 'empty', type: 'command' }, { id: 'noscript', type: 'shell' }, { id: 'ok', command: 'a' }],
				},
			],
		});
		assert.deepStrictEqual(pipelines[0].nodes.map((node) => node.id), ['empty', 'noscript', 'ok']);
		assert.strictEqual(pipelines[0].nodes[0].command, '');
		assert.strictEqual(pipelines[0].nodes[1].script, '');
	});

	test('связь на несуществующий узел не сохраняется', () => {
		const pipelines = normalizePipelines({
			pipelines: [
				{
					id: 'p',
					name: 'П',
					nodes: [{ id: 'a', command: 'a' }],
					edges: [{ from: 'a', to: 'ghost' }, { from: 'a', to: 'a' }, { from: 'a' }],
				},
			],
		});
		assert.deepStrictEqual(pipelines[0].edges, []);
	});

	test('повторяющиеся идентификаторы разводятся суффиксом', () => {
		const pipelines = normalizePipelines({
			pipelines: [
				{ id: 'build', name: 'Первый', nodes: [{ id: 'n', command: 'a' }, { id: 'n', command: 'b' }] },
				{ id: 'build', name: 'Второй', nodes: [] },
			],
		});
		assert.deepStrictEqual(pipelines.map((item) => item.id), ['build', 'build-2']);
		assert.deepStrictEqual(pipelines[0].nodes.map((node) => node.id), ['n', 'n-2']);
	});

	test('мусор вместо файла не роняет разбор', () => {
		assert.deepStrictEqual(normalizePipelines(undefined), []);
		assert.deepStrictEqual(normalizePipelines({ pipelines: 'нет' }), []);
		assert.deepStrictEqual(normalizePipelines({ pipelines: [42, null] }), []);
	});

	test('значения по умолчанию в файл не пишутся', () => {
		const text = serializePipelines(
			normalizePipelines({
				pipelines: [
					{
						id: 'p',
						name: 'П',
						nodes: [{ id: 'a', type: 'command', command: 'a', enabled: true }],
						edges: [{ from: 'a', to: 'a', on: 'success' }],
					},
				],
			})
		);
		assert.ok(!text.includes('enabled'), text);
		assert.ok(!text.includes('"on"'), text);
		assert.ok(text.includes('pipelines.schema.json'), 'в файле остаётся ссылка на схему');
		assert.ok(text.includes('"version": 2'), text);
	});

	test('начальные узлы: те, у кого нет входящих связей', () => {
		const [pipeline] = normalizePipelines({
			pipelines: [
				{
					id: 'p',
					name: 'П',
					nodes: [{ id: 'a', command: 'a' }, { id: 'b', command: 'b' }, { id: 'c', command: 'c' }],
					edges: [{ from: 'a', to: 'c' }],
				},
			],
		});
		assert.deepStrictEqual(startNodes(pipeline).map((node) => node.id), ['a', 'b']);
	});

	test('склонение числа шагов', () => {
		assert.deepStrictEqual([1, 2, 5, 11, 21, 104].map(stepsWord), ['шаг', 'шага', 'шагов', 'шагов', 'шаг', 'шага']);
	});
});

suite('запись файла пайплайнов', () => {
	test('пустое действие в файл не пишется, но узел остаётся', () => {
		const text = serializePipelines(
			normalizePipelines({
				pipelines: [
					{ id: 'p', name: 'Ц', nodes: [{ id: 'a', type: 'shell' }, { id: 'b', type: 'command' }] },
				],
			})
		);
		// именно ключи: значение "command" встречается в поле type
		assert.ok(!text.includes('"script":'), text);
		assert.ok(!text.includes('"command":'), text);
		const back = normalizePipelines(JSON.parse(text));
		assert.deepStrictEqual(back[0].nodes.map((node) => node.id), ['a', 'b']);
		assert.strictEqual(back[0].nodes[0].script, '');
	});
});

suite('профиль и окружение пайплайна', () => {
	const [pipeline] = normalizePipelines({
		pipelines: [
			{
				id: 'ci',
				name: 'CI',
				profile: 'ci',
				environment: null,
				nodes: [
					{ id: 'inherit', command: '1c-platform-tools.cf.load' },
					{ id: 'own', command: '1c-platform-tools.cf.load', profile: 'dev', environment: 'test' },
					{ id: 'editor', command: '1c-platform-tools.cf.load', profile: EDITOR_SELECTION, environment: EDITOR_SELECTION },
					{ id: 'off', command: '1c-platform-tools.cf.load', profile: 'missing', enabled: false },
				],
				edges: [],
			},
		],
	});
	const node = (id: string) => {
		const found = pipeline.nodes.find((candidate) => candidate.id === id);
		assert.ok(found, id);
		return found;
	};

	test('шаг берёт свои профиль и окружение, иначе пайплайна, а «как в редакторе» не подменяет выбор', () => {
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('inherit')), { profile: 'ci', environment: null });
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('own')), { profile: 'dev', environment: 'test' });
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('editor')), {});
	});

	test('у пайплайна «как в редакторе» сохраняется в файле и значит то же, что без поля', () => {
		const [explicit] = normalizePipelines({
			pipelines: [{ id: 'p', name: 'P', profile: EDITOR_SELECTION, environment: EDITOR_SELECTION, nodes: [{ id: 'a' }] }],
		});
		assert.strictEqual(explicit.profile, EDITOR_SELECTION);
		assert.strictEqual(explicit.environment, EDITOR_SELECTION);
		assert.deepStrictEqual(nodeLaunchSelection(explicit, explicit.nodes[0]), {});
		assert.ok(serializePipelines([pipeline]).includes('"environment": null'), 'окружение по умолчанию сохраняется как null');
	});

	test('выбор при запуске заменяет выбор редактора, свои значения пайплайна и шагов остаются', () => {
		const run = { profile: 'nightly', environment: 'stage' };
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('editor'), run), run);
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('own'), run), { profile: 'dev', environment: 'test' });
		assert.deepStrictEqual(nodeLaunchSelection(pipeline, node('inherit'), run), { profile: 'ci', environment: null });
	});

	test('при запуске спрашивается только то, что шаги берут из редактора', () => {
		assert.deepStrictEqual(editorLaunchUse(pipeline), { profile: true, environment: true });
		const [fixed] = normalizePipelines({
			pipelines: [{
				id: 'f',
				name: 'F',
				profile: 'ci',
				nodes: [{ id: 'load', command: '1c-platform-tools.cf.load' }, { id: 'sh', type: 'shell', script: 'echo', profile: EDITOR_SELECTION }],
			}],
		});
		assert.deepStrictEqual(editorLaunchUse(fixed), { profile: false, environment: true }, 'профиль шагу оболочки не нужен');
	});

	test('ссылки на профили и окружения, которых нет в проекте; «По умолчанию» и выключенные шаги не проверяются', () => {
		assert.deepStrictEqual(missingLaunchReferences(pipeline, ['default', 'ci', 'dev'], ['test']), []);
		assert.deepStrictEqual(missingLaunchReferences(pipeline, ['default'], []), [
			'профиля «ci» нет в проекте',
			'профиля «dev» нет в проекте',
			'окружения «test» нет в проекте',
		]);
		const [onDefault] = normalizePipelines({ pipelines: [{ id: 'd', name: 'D', profile: 'default', nodes: [] }] });
		assert.deepStrictEqual(missingLaunchReferences(onDefault, [], []), []);
	});
});
