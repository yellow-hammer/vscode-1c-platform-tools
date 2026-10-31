import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasProjectFile } from '../../shared/projectLayout';
import { runWithProject } from '../../shared/workspaceProjects';
import { initializeProjectCommand } from '../../features/projects/workspaceProjectCommands';
import {
	initializeChoices,
	initializeProject,
	initializeProjectResult,
	type InitializeChoice,
	type InitializeProjectUi,
} from '../../features/projects/projectInitialization';
import {
	copyFixtures,
	DELIVERY,
	ACCOUNTING,
	detectedProjects,
	ONESCRIPT_TEMPLATE,
	resetLayout,
	TEMPLATE,
	TWO_CONFIGURATIONS,
} from './workspaceProjectsFixture';

/** Ответы пользователя и что у него спрашивали. */
function recordingUi(answers: { pick?: string; overwrite?: boolean; oneScript?: boolean } = {}) {
	const asked = { choices: [] as InitializeChoice[][], kinds: [] as boolean[], overwrite: [] as string[], opened: [] as string[], noFolder: 0 };
	const ui: InitializeProjectUi = {
		pickDirectory: async (choices) => {
			asked.choices.push([...choices]);
			return answers.pick;
		},
		pickKind: async (suggested) => {
			asked.kinds.push(suggested);
			return answers.oneScript ?? false;
		},
		confirmOverwrite: async (file) => {
			asked.overwrite.push(file);
			return answers.overwrite ?? false;
		},
		openProjectFile: async (file) => {
			asked.opened.push(file);
		},
		noFolder: () => {
			asked.noFolder += 1;
		},
	};
	return { ui, asked };
}

suite('проекты: инициализация', () => {
	setup(() => {
		resetLayout();
	});

	test('единственная папка: packagedef из шаблона, проект текущий, файл открыт', async () => {
		const copy = copyFixtures('без-packagedef');
		const [root] = copy.roots;
		const fixture = await detectedProjects([root]);
		const { ui, asked } = recordingUi();
		try {
			const created = await initializeProject(fixture.source, undefined, ui);

			const file = path.join(root, 'packagedef');
			assert.strictEqual(created, root);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), fs.readFileSync(TEMPLATE, 'utf8'));
			assert.deepStrictEqual(asked.choices, []);
			assert.deepStrictEqual(asked.opened, [file]);
			assert.strictEqual(fixture.instance.currentRoot(), root);
			assert.deepStrictEqual((await fixture.source.listProjects()).map((project) => project.root), [root]);
			assert.deepStrictEqual(await fixture.source.listCandidates(), []);
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('packagedef уже есть: без согласия файл не трогается, с согласием перезаписывается', async () => {
		const copy = copyFixtures('проект');
		const [root] = copy.roots;
		const file = path.join(root, 'packagedef');
		const before = fs.readFileSync(file, 'utf8');
		const fixture = await detectedProjects([root]);
		try {
			const refused = recordingUi({ overwrite: false });
			assert.strictEqual(await initializeProject(fixture.source, root, refused.ui), undefined);
			assert.deepStrictEqual(refused.asked.overwrite, [file]);
			assert.deepStrictEqual(refused.asked.opened, []);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), before);

			const accepted = recordingUi({ overwrite: true });
			assert.strictEqual(await initializeProject(fixture.source, root, accepted.ui), root);
			assert.strictEqual(fs.readFileSync(file, 'utf8'), fs.readFileSync(TEMPLATE, 'utf8'));
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('несколько папок: спрашивает каталог, отказ ничего не создаёт', async () => {
		const copy = copyFixtures('без-packagedef', 'пустая');
		const [source, empty] = copy.roots;
		const fixture = await detectedProjects(copy.roots);
		const { ui, asked } = recordingUi();
		try {
			assert.strictEqual(await initializeProject(fixture.source, undefined, ui), undefined);

			assert.deepStrictEqual(
				asked.choices.map((choices) => choices.map((choice) => [choice.dir, choice.label, choice.description])),
				[[[source, 'без-packagedef', 'Конфигуратор · БезПроекта'], [empty, 'пустая', undefined]]]
			);
			assert.strictEqual(hasProjectFile(source), false);
			assert.strictEqual(hasProjectFile(empty), false);
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('каталог без исходного кода 1С: вид проекта спрашивается, у проекта OneScript свой шаблон', async () => {
		const copy = copyFixtures('пустая');
		const [empty] = copy.roots;
		const fixture = await detectedProjects([empty]);
		const { ui, asked } = recordingUi({ oneScript: true });
		try {
			assert.strictEqual(await initializeProject(fixture.source, undefined, ui), empty);

			const expected = fs.readFileSync(ONESCRIPT_TEMPLATE, 'utf8').replaceAll('{{name}}', path.basename(empty));
			assert.strictEqual(fs.readFileSync(path.join(empty, 'packagedef'), 'utf8'), expected);
			assert.deepStrictEqual(asked.kinds, [false], 'пустой каталог на пакет OneScript не похож');
			assert.strictEqual((await fixture.source.listProjects())[0].kind, 'onescript');
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('несколько папок: выбранный каталог становится проектом', async () => {
		const copy = copyFixtures('без-packagedef', 'пустая');
		const [, empty] = copy.roots;
		const fixture = await detectedProjects(copy.roots);
		const { ui } = recordingUi({ pick: empty });
		try {
			assert.strictEqual(await initializeProject(fixture.source, undefined, ui), empty);
			assert.strictEqual(hasProjectFile(empty), true);
			assert.strictEqual(fixture.instance.currentRoot(), empty);
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('варианты: папки рабочей области, затем вторые конфигурации', async () => {
		const fixture = await detectedProjects([TWO_CONFIGURATIONS]);
		try {
			const choices = initializeChoices(fixture.folders, await fixture.source.listCandidates());

			assert.deepStrictEqual(
				choices.map((choice) => [choice.dir, choice.label, choice.description]),
				[
					[TWO_CONFIGURATIONS, 'две-конфигурации', 'уже проект'],
					[DELIVERY, 'поставка', 'вторая конфигурация · Конфигуратор · Вторая'],
					[ACCOUNTING, 'учёт', 'вторая конфигурация · EDT · Учёт'],
				]
			);
		} finally {
			fixture.instance.dispose();
		}
	});

	test('для агента: без каталога при нескольких вариантах отказ с вариантами, с каталогом проект', async () => {
		const copy = copyFixtures('без-packagedef', 'пустая');
		const [source, empty] = copy.roots;
		const fixture = await detectedProjects(copy.roots);
		try {
			const refused = await initializeProjectResult(fixture.source, undefined);
			assert.strictEqual(refused.success, false);
			assert.ok(refused.stderr.includes(source) && refused.stderr.includes(empty), refused.stderr);

			const created = await initializeProjectResult(fixture.source, source);
			assert.strictEqual(created.success, true);
			assert.deepStrictEqual(created.data, { root: source, current: source });

			const exists = await initializeProjectResult(fixture.source, source);
			assert.strictEqual(exists.success, false);
			assert.strictEqual(exists.stderr, `Файл packagedef уже есть: ${path.join(source, 'packagedef')}`);
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});

	test('команда для агента: каталог из projectPath, root или корня вызова, без вопросов', async () => {
		const copy = copyFixtures('без-packagedef', 'пустая');
		const [source, empty] = copy.roots;
		const fixture = await detectedProjects(copy.roots);
		try {
			const byPath = await initializeProjectCommand(fixture.source, { wait: true, projectPath: empty });
			assert.deepStrictEqual(byPath?.data, { root: empty, current: empty });
			assert.strictEqual(byPath?.stdout, '');

			const byCallRoot = await runWithProject(source, () => initializeProjectCommand(fixture.source, {}));
			assert.deepStrictEqual(byCallRoot?.data, { root: source, current: source });
			assert.strictEqual(hasProjectFile(source), true);

			const byRoot = await initializeProjectCommand(fixture.source, { root: empty }, { wait: true });
			assert.strictEqual(byRoot?.stderr, `Файл packagedef уже есть: ${path.join(empty, 'packagedef')}`);
		} finally {
			fixture.instance.dispose();
			copy.dispose();
		}
	});
});
