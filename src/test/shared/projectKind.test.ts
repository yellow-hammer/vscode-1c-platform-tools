import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectProjectKind, isOneCProjectKind, projectKindOf } from '../../shared/projectKind';
import type { ProjectLayout, SourceRoot } from '../../shared/projectLayout';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/workspaceProjects');
const PACKAGEDEFS = path.resolve(__dirname, '../../../src/test/fixtures/packagedefs');
const TEMPLATES = path.resolve(__dirname, '../../../resources/templates');

function layout(parts: Partial<ProjectLayout> = {}): ProjectLayout {
	return {
		extensions: [],
		testExtensions: [],
		others: [],
		processors: [],
		reports: [],
		testProcessors: [],
		externals: [],
		subProjects: [],
		...parts,
	};
}

const root = (format: SourceRoot['format'], isExtension = false): SourceRoot => ({ dir: '/p/src', format, name: 'Имя', isExtension });

const LIBRARY = `
Описание.Имя("prometheus")
    .ВерсияСреды("2.0.0")
    .РазработкаЗависитОт("1testrunner")
    .ОпределяетКласс("CollectorRegistry", "src/Классы/CollectorRegistry.os")
;`;

const NEW_ONEC_PROJECT = `
Описание.Имя("project-1с")
    .ЗависитОт("add")
    .ЗависитОт("vanessa-runner", "3.0.0")
;`;

suite('вид проекта', () => {
	test('исходный код 1С решает формат, даже если пакет объявляет классы', () => {
		assert.strictEqual(projectKindOf(layout({ configuration: root('designer') }), LIBRARY), 'designer');
		assert.strictEqual(projectKindOf(layout({ configuration: root('edt') }), ''), 'edt');
		assert.strictEqual(projectKindOf(layout({ extensions: [root('edt', true)] }), ''), 'edt');
		assert.strictEqual(
			projectKindOf(layout({ processors: [{ dir: '/p/src/epf/Печать', format: 'designer', kind: 'processor', name: 'Печать', file: 'Печать' }] }), ''),
			'designer'
		);
	});

	test('без исходного кода: объявленные классы, модули и исполняемый файл это OneScript', () => {
		assert.strictEqual(projectKindOf(layout(), LIBRARY), 'onescript');
		assert.strictEqual(projectKindOf(layout(), 'Описание.Имя("app").ИсполняемыйФайл("src/main.os", "app");'), 'onescript');
		assert.strictEqual(projectKindOf(layout(), 'Description.Name("lib").DefinesModule("Lib", "src/Lib.os");'), 'onescript');
		assert.strictEqual(projectKindOf(layout(), `${NEW_ONEC_PROJECT}\n.ОпределяетМодуль("Сборка", "tasks/Сборка.os")`), 'onescript');
	});

	test('без исходного кода: зависимость от инструментов 1С это проект 1С, остальное OneScript', () => {
		assert.strictEqual(projectKindOf(layout(), NEW_ONEC_PROJECT), 'onec');
		assert.strictEqual(projectKindOf(layout(), 'Описание.Имя("x").РазработкаЗависитОт("vanessa-automation-single");'), 'onec');
		assert.strictEqual(projectKindOf(layout(), 'Описание.Имя("x").ЗАВИСИТОТ("Vanessa-Runner");'), 'onec');
		assert.strictEqual(projectKindOf(layout(), 'Описание.Имя("deploy");'), 'onescript');
		assert.strictEqual(projectKindOf(layout(), 'Описание.Имя("x").ЗависитОт("addins");'), 'onescript');
	});

	test('настоящие пакеты без исходного кода 1С — OneScript, даже без ОпределяетКласс', () => {
		for (const name of ['fs', 'json', '1testrunner', 'mutatos', 'autumn', 'oneunit', 'gitsync']) {
			const packagedef = fs.readFileSync(path.join(PACKAGEDEFS, `${name}.packagedef`), 'utf8');
			assert.strictEqual(projectKindOf(layout(), packagedef), 'onescript', name);
		}
	});

	test('шаблоны нового проекта: 1С и OneScript', () => {
		const read = (name: string) => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
		assert.strictEqual(projectKindOf(layout(), read('packagedef.template')), 'onec');
		assert.strictEqual(projectKindOf(layout(), read('packagedef-onescript.template')), 'onescript');
	});

	test('закомментированные строки packagedef не в счёт', () => {
		assert.strictEqual(projectKindOf(layout(), `${NEW_ONEC_PROJECT}\n// .ОпределяетКласс("Класс", "src/Класс.os")`), 'onec');
	});

	test('проектом OneScript работают без платформы', () => {
		assert.deepStrictEqual(
			(['designer', 'edt', 'onec', 'onescript'] as const).map(isOneCProjectKind),
			[true, true, true, false]
		);
	});

	test('каталог: вид по раскладке и packagedef, без packagedef вида нет', async () => {
		assert.strictEqual(await detectProjectKind(path.join(FIXTURES, 'проект')), 'designer');
		assert.strictEqual(await detectProjectKind(path.join(FIXTURES, 'инструменты', 'tools', 'deploy')), 'onescript');
		assert.strictEqual(await detectProjectKind(path.join(FIXTURES, 'без-packagedef')), undefined);
	});
});
