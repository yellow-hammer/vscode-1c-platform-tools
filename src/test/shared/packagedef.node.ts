/**
 * Разбор packagedef настоящих пакетов OneScript и шаблонов расширения.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { declaresPackageApi, dependsOn, packageFileName, parsePackagedef } from '../../shared/packagedef';

/** Корень репозитория: тесты собираются в out, путь от __dirname другой. */
function repositoryRoot(): string {
	let dir = __dirname;
	while (!fs.existsSync(path.join(dir, 'package.json'))) {
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error('Не найден корень репозитория');
		}
		dir = parent;
	}
	return dir;
}

const ROOT = repositoryRoot();
const read = (name: string) => fs.readFileSync(path.join(ROOT, 'src', 'test', 'fixtures', 'packagedefs', `${name}.packagedef`), 'utf8');
const template = (name: string) => fs.readFileSync(path.join(ROOT, 'resources', 'templates', name), 'utf8');

describe('packagedef настоящих пакетов', () => {
	test('фикстуры на месте', () => {
		for (const name of ['fs', 'json', '1testrunner', 'mutatos', 'autumn', 'oneunit', 'gitsync']) {
			assert.match(read(name), /Описание\.Имя/, name);
		}
	});

	test('fs: имя, версия и включаемые файлы, классов нет', () => {
		const manifest = parsePackagedef(read('fs'));

		assert.equal(manifest.name, 'fs');
		assert.equal(manifest.version, '1.2.0');
		assert.deepEqual(manifest.includes, ['Модули', 'LICENSE', 'README.md']);
		assert.equal(declaresPackageApi(manifest), false);
		assert.equal(packageFileName(manifest), 'fs-1.2.0.ospx');
	});

	test('mutatos: версия среды, исполняемый файл и зависимости разработки', () => {
		const manifest = parsePackagedef(read('mutatos'));

		assert.equal(manifest.engineVersion, '2.0.0');
		assert.deepEqual(manifest.executables, [{ file: 'src/cli/main.os', name: 'mutatos' }]);
		assert.deepEqual(manifest.dependencies.find((item) => item.name === 'oneunit'), { name: 'oneunit', version: '0.5.0', dev: false });
		assert.deepEqual(
			manifest.dependencies.filter((item) => item.dev).map((item) => item.name),
			['asserts', 'moskito']
		);
		assert.equal(declaresPackageApi(manifest), true);
	});

	test('autumn: пакет и обычной зависимостью, и разработки остаётся обычной', () => {
		const manifest = parsePackagedef(read('autumn'));
		const asserts = manifest.dependencies.filter((item) => item.name === 'asserts');

		assert.deepEqual(asserts, [{ name: 'asserts', version: '1.6.2', dev: false }]);
		assert.ok(manifest.classes.some((item) => item.name === 'Поделка' && item.file === 'src/Классы/Поделка.os'));
		assert.ok(manifest.modules.some((item) => item.name === 'СостоянияПриложения'));
		assert.equal(manifest.engineVersion, '2.2.1');
		assert.equal(dependsOn(manifest, 'OneUnit'), true, 'имя зависимости без учёта регистра');
	});

	test('1testrunner и OneUnit: вычисленные имя и версия неизвестны, литералы читаются', () => {
		const testrunner = parsePackagedef(read('1testrunner'));
		assert.equal(testrunner.name, '1testrunner');
		assert.equal(testrunner.version, undefined);
		assert.equal(packageFileName(testrunner), undefined);
		assert.deepEqual(testrunner.executables, [{ file: 'src/main.os', name: '1testrunner' }]);
		assert.deepEqual(testrunner.dependencies.find((item) => item.name === 'fs'), { name: 'fs', version: '1.0.0', dev: false });

		const oneunit = parsePackagedef(read('oneunit'));
		assert.equal(oneunit.name, undefined);
		assert.equal(oneunit.version, undefined);
		assert.equal(oneunit.engineVersion, '2.2.0');
		assert.deepEqual(oneunit.executables, [{ file: 'src/cli/main.os', name: undefined }]);
	});

	test('gitsync: ВерсияСреды из переменной неизвестна, одноимённая переменная не метод', () => {
		const manifest = parsePackagedef(read('gitsync'));

		assert.equal(manifest.name, 'gitsync');
		assert.equal(manifest.engineVersion, undefined);
		assert.equal(manifest.version, undefined);
		assert.ok(manifest.includes.includes('templates/temp.cfe'));
		assert.equal(manifest.executables.length, 1);
	});

	test('json: классы в lib.config, packagedef их не объявляет', () => {
		const manifest = parsePackagedef(read('json'));

		assert.deepEqual(manifest.includes, ['src', 'tests', 'lib.config']);
		assert.equal(declaresPackageApi(manifest), false);
	});
});

describe('packagedef: правила opm', () => {
	test('повторное объявление меняет версию, ЗависитОт делает зависимость обычной', () => {
		const manifest = parsePackagedef(
			'Описание.Имя("x").РазработкаЗависитОт("a", "1.0").ЗависитОт("a").РазработкаЗависитОт("b").РазработкаЗависитОт("b", "2.0");'
		);

		assert.deepEqual(manifest.dependencies, [
			{ name: 'a', version: '1.0', dev: false },
			{ name: 'b', version: '2.0', dev: true },
		]);
	});

	test('комментарии и каталог задач', () => {
		const manifest = parsePackagedef('Описание.Имя("x")\n// .ЗависитОт("закомментирован")\n.Задачи("./build/tasks");');

		assert.deepEqual(manifest.dependencies, []);
		assert.equal(manifest.tasks, 'build/tasks');
	});

	test('английских имён методов у opm нет', () => {
		const manifest = parsePackagedef('Description.Name("lib").DependsOn("logos").DefinesModule("Lib", "src/Lib.os");');

		assert.equal(manifest.name, undefined);
		assert.deepEqual(manifest.dependencies, []);
		assert.equal(declaresPackageApi(manifest), false);
	});
});

describe('шаблоны packagedef расширения', () => {
	test('шаблон OneScript: инструменты тестов только для разработки, имя подставляется', () => {
		const manifest = parsePackagedef(template('packagedef-onescript.template').replaceAll('{{name}}', 'пакет'));

		assert.equal(manifest.name, 'пакет');
		assert.equal(manifest.engineVersion, '2.2.1');
		assert.deepEqual(
			manifest.dependencies.map((item) => [item.name, item.dev]),
			[['oneunit', true], ['asserts', true], ['mutatos', true]]
		);
		assert.deepEqual(manifest.includes, ['src']);
	});

	test('шаблон проекта 1С: инструменты 1С зависимостями', () => {
		const manifest = parsePackagedef(template('packagedef.template'));

		assert.equal(dependsOn(manifest, 'vanessa-runner'), true);
		assert.equal(declaresPackageApi(manifest), false);
	});
});
