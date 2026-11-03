/**
 * Разбор packagedef настоящих пакетов OneScript и шаблонов расширения.
 * Запуск: npm run test:node
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { adoptExistingOneScriptMembers } from '../../shared/oneScriptMembers';
import {
	appendPackageMember,
	autumnPropertiesOf,
	declaresPackageApi,
	dependsOn,
	packageFileName,
	packageMembers,
	parsePackagedef,
	oscriptConfigDirectories,
	removePackageMember,
} from '../../shared/packagedef';

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

	test('комментарий не объявляет зависимость', () => {
		const manifest = parsePackagedef('Описание.Имя("x")\n// .ЗависитОт("закомментирован")\n.Версия("1");');

		assert.deepEqual(manifest.dependencies, []);
		assert.equal(manifest.version, '1');
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
			[['oneunit', true], ['asserts', true], ['mutatos', true], ['depos', true]]
		);
		assert.deepEqual(manifest.includes, ['src', 'tests']);
		assert.deepEqual(manifest.executables, []);
		assert.deepEqual(autumnPropertiesOf(manifest), {
			пакет: {
				ИмяПриложения: 'пакет',
				ПолноеИмяПриложения: 'пакет v%{пакет.ВерсияПриложения}',
				ВерсияПриложения: '1.0.0',
			},
		});
	});

	test('шаблон проекта 1С: инструменты 1С зависимостями', () => {
		const manifest = parsePackagedef(template('packagedef-1c.template'));

		assert.equal(dependsOn(manifest, 'vanessa-runner'), true);
		assert.equal(dependsOn(manifest, 'depos'), true);
		assert.equal(manifest.dependencies.find((item) => item.name === 'depos')?.dev, true);
		assert.equal(declaresPackageApi(manifest), false);
	});
});

describe('состав пакета из packagedef', () => {
	const autumn = `
		Описание.Имя("autumn")
			.ОпределяетКласс("Поделка", "src/Классы/Поделка.os")
			.ОпределяетМодуль("СостоянияПриложения", "src/Модули/СостоянияПриложения.os")
			.ИсполняемыйФайл("src/main.os", "autumn");
	`;

	test('классы, модули и программы читаются из объявлений', () => {
		assert.deepEqual(packageMembers(parsePackagedef(autumn)), [
			{ kind: 'class', name: 'Поделка', file: 'src/Классы/Поделка.os' },
			{ kind: 'module', name: 'СостоянияПриложения', file: 'src/Модули/СостоянияПриложения.os' },
			{ kind: 'executable', name: 'autumn', file: 'src/main.os' },
		]);
	});

	test('объявление класса убирается, остальная цепочка остаётся', () => {
		const source = 'Описание.Имя("autumn").ОпределяетКласс("Поделка", "src/Классы/Поделка.os").Версия("1.0.0");\n';
		const next = removePackageMember(source, 'class', 'Поделка');
		assert.equal(next.includes('Поделка'), false);
		assert.equal(parsePackagedef(next).name, 'autumn');
		assert.equal(parsePackagedef(next).version, '1.0.0');
	});

	test('oscript.cfg пишется рядом с программой, не в корне', () => {
		const manifest = parsePackagedef('Описание.ИсполняемыйФайл("src/main.os").ИсполняемыйФайл("tools/cli.os", "cli");');
		assert.deepEqual(oscriptConfigDirectories(manifest), ['src', 'tools']);
	});

	test('программа без имени команды — src/main.os, имя подставляет opm', () => {
		const source = 'Описание.Имя("app");\n';
		const next = appendPackageMember(source, 'executable', '', 'src/main.os');
		assert.equal(next.includes('.ИсполняемыйФайл("src/main.os")'), true);
		assert.equal(parsePackagedef(next).executables[0]?.file, 'src/main.os');
		assert.equal(parsePackagedef(next).executables[0]?.name, undefined);
		const removed = removePackageMember(next, 'executable', 'src/main.os');
		assert.equal(parsePackagedef(removed).executables.length, 0);
		const named = appendPackageMember(source, 'executable', 'app', 'src/main.os');
		assert.equal(parsePackagedef(removePackageMember(named, 'executable', 'src/main.os')).executables.length, 0);
	});

	test('перезаписанный packagedef снова видит лежащие файлы', async () => {
		const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'os-members-'));
		try {
			await fs.promises.mkdir(path.join(root, 'src', 'Классы'), { recursive: true });
			await fs.promises.writeFile(path.join(root, 'src', 'main.os'), 'Сообщить("есть");\n');
			await fs.promises.writeFile(path.join(root, 'src', 'Классы', 'Поделка.os'), '\n');
			await fs.promises.writeFile(path.join(root, 'packagedef'), 'Описание.Имя("app");\n');
			await adoptExistingOneScriptMembers(root);
			const manifest = parsePackagedef(await fs.promises.readFile(path.join(root, 'packagedef'), 'utf8'));
			assert.equal(manifest.executables[0]?.file, 'src/main.os');
			assert.equal(manifest.executables[0]?.name, undefined);
			assert.equal(
				packageMembers(manifest).some((member) => member.kind === 'class' && member.name === 'Поделка'),
				true
			);
		} finally {
			await fs.promises.rm(root, { recursive: true, force: true });
		}
	});

	test('класс встаёт к классам, модуль к модулям, программа после них', () => {
		const withClass = appendPackageMember(autumn, 'class', 'Завязь', 'src/Классы/Завязь.os');
		const classAt = withClass.indexOf('ОпределяетКласс("Завязь"');
		assert.ok(withClass.indexOf('ОпределяетКласс("Поделка"') < classAt);
		assert.ok(classAt < withClass.indexOf('ОпределяетМодуль'));

		const bare = 'Описание.Имя("app")\n    .Версия("1.0.0")\n    .ИсполняемыйФайл("src/main.os")\n;\n';
		const withModule = appendPackageMember(bare, 'module', 'Журнал', 'src/Модули/Журнал.os');
		assert.ok(withModule.indexOf('ОпределяетМодуль') < withModule.indexOf('ИсполняемыйФайл'));
		assert.equal(
			packageMembers(parsePackagedef(withClass)).some((member) => member.name === 'Завязь'),
			true
		);
	});

	test('убирается объявление, комментарий с тем же вызовом остаётся', () => {
		const source = [
			'// .ОпределяетКласс("Поделка", "src/Классы/Поделка.os")',
			'Описание.Имя("app").ОпределяетКласс("Поделка", "src/Классы/Поделка.os").Версия("1.0.0");',
			'',
		].join('\n');
		const next = removePackageMember(source, 'class', 'Поделка');
		assert.equal(next.includes('// .ОпределяетКласс("Поделка"'), true);
		assert.equal(parsePackagedef(next).classes.length, 0);
		assert.equal(parsePackagedef(next).version, '1.0.0');
		assert.equal(next.includes('.Версия("1.0.0")'), true);
	});

	test('из двух программ убирается одна, вторая остаётся', () => {
		const source = 'Описание.Имя("app").ИсполняемыйФайл("src/main.os").ИсполняемыйФайл("src/cli.os", "cli");\n';
		const files = parsePackagedef(removePackageMember(source, 'executable', 'src/main.os')).executables.map((item) => item.file);
		assert.deepEqual(files, ['src/cli.os']);
	});
});
