import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { invalidateProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import { directoriesOf } from '../../features/metadata/mdSparrowParams';
import {
	cachedByFiles,
	forgetCachedReads,
	readCachedEntry,
	runtimeSalt,
	sourceFingerprint,
	sourceRoots,
	writeCached,
} from '../../features/metadata/mdSparrowCache';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

function copyFixture(name: string): string {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sparrow-cache-'));
	fs.cpSync(path.join(FIXTURES, name), target, { recursive: true });
	return target;
}

suite('кэш ответов md-sparrow', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('корни отпечатка: конфигурации, расширения и внешние объекты, тестовые тоже', async () => {
		const roots = await sourceRoots(path.join(FIXTURES, 'designer'));
		const relative = roots.map((root) => path.relative(path.join(FIXTURES, 'designer'), root).split(path.sep).join('/')).sort();

		assert.deepStrictEqual(relative, [
			'src/cf',
			'src/cfe/МоёРасширение',
			'src/cfe/подмодуль/src/cf',
			'src/cfe/подмодуль/src/cfe/Вложенное',
			'src/epf/ПечатьСчёта',
			'src/erf/ОстаткиТоваров',
			'src/erf/ОтчётПоОстаткам',
			'tests/cfe/Тесты',
			'tests/epf/Тесты_Арифметика',
		]);
	});

	test('отпечаток стабилен, меняется от соли и от правки описания', async () => {
		const root = copyFixture('designer');
		try {
			const first = await sourceFingerprint(root, ['a']);
			assert.strictEqual(await sourceFingerprint(root, ['a']), first);
			assert.notStrictEqual(await sourceFingerprint(root, ['b']), first);

			const descriptor = path.join(root, 'src', 'cf', 'Configuration.xml');
			const later = new Date(fs.statSync(descriptor).mtimeMs + 5000);
			fs.utimesSync(descriptor, later, later);
			invalidateProjectLayout();
			assert.notStrictEqual(await sourceFingerprint(root, ['a']), first);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('права роли и командный интерфейс проекта EDT меняют отпечаток', async () => {
		const root = copyFixture('edt-workspace');
		try {
			const rights = path.join(root, 'ssl31', 'src', 'Roles', 'Роль', 'Rights.rights');
			fs.mkdirSync(path.dirname(rights), { recursive: true });
			fs.writeFileSync(rights, '<Rights/>', 'utf8');
			invalidateProjectLayout();
			const before = await sourceFingerprint(root, ['a']);

			fs.writeFileSync(rights, '<Rights><object/></Rights>', 'utf8');
			invalidateProjectLayout();
			assert.notStrictEqual(await sourceFingerprint(root, ['a']), before);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('отметка сборки: у релиза тег, у локального jar размер и время', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sparrow-jar-'));
		const jarPath = path.join(dir, 'md-sparrow-all.jar');
		fs.writeFileSync(jarPath, 'сборка');
		try {
			assert.strictEqual(await runtimeSalt({ java: 'java', jarPath, releaseTag: 'v0.5.7' }), 'v0.5.7');
			const first = await runtimeSalt({ java: 'java', jarPath });
			assert.ok(first.startsWith(jarPath), first);

			fs.writeFileSync(jarPath, 'сборка следующая');
			assert.notStrictEqual(await runtimeSalt({ java: 'java', jarPath }), first);
			assert.strictEqual(await runtimeSalt({ java: 'java', jarPath: path.join(dir, 'нет.jar') }), path.join(dir, 'нет.jar'));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('ответ по файлу берётся из памяти, пока файл не менялся', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sparrow-file-'));
		const file = path.join(dir, 'Справочник.xml');
		fs.writeFileSync(file, '<Catalog/>');
		let reads = 0;
		const read = async () => {
			reads += 1;
			return { exitCode: 0, stdout: `ответ ${reads}`, stderr: '' };
		};
		try {
			forgetCachedReads();
			const first = await cachedByFiles('op|file', [file], ['соль'], read, (value) => value.exitCode === 0);
			const second = await cachedByFiles('op|file', [file], ['соль'], read, (value) => value.exitCode === 0);
			assert.strictEqual(second.stdout, first.stdout);
			assert.strictEqual(reads, 1);

			// другая соль это другой запрос
			await cachedByFiles('op|file', [file], ['другая'], read, (value) => value.exitCode === 0);
			assert.strictEqual(reads, 2);

			const later = new Date(fs.statSync(file).mtimeMs + 5000);
			fs.utimesSync(file, later, later);
			await cachedByFiles('op|file', [file], ['другая'], read, (value) => value.exitCode === 0);
			assert.strictEqual(reads, 3);

			// отказ не запоминается
			let failures = 0;
			const failing = async () => {
				failures += 1;
				return { exitCode: 1, stdout: '', stderr: 'не вышло' };
			};
			await cachedByFiles('op|fail', [file], ['соль'], failing, (value) => value.exitCode === 0);
			await cachedByFiles('op|fail', [file], ['соль'], failing, (value) => value.exitCode === 0);
			assert.strictEqual(failures, 2);
		} finally {
			forgetCachedReads();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('кэш отдаёт ответ вместе с отпечатком и молчит о чужой форме', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sparrow-cache-'));
		const file = path.join(dir, 'deep', 'tree.json');
		const isTree = (value: unknown): value is { sources: unknown[] } =>
			typeof value === 'object' && value !== null && Array.isArray((value as { sources?: unknown }).sources);
		try {
			await writeCached(file, 'f1', { sources: [1, 2] });
			assert.deepStrictEqual(await readCachedEntry(file, isTree), { fingerprint: 'f1', payload: { sources: [1, 2] } });
			assert.strictEqual(await readCachedEntry(path.join(dir, 'нет.json'), isTree), undefined);

			await writeCached(file, 'f1', { sources: 'не список' });
			assert.strictEqual(await readCachedEntry(file, isTree), undefined);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('состав подсистем зависит от каталога подсистем в обоих форматах', () => {
		const designer = directoriesOf({ op: 'cf-md-subsystem-tree', configurationXml: path.join('w', 'src', 'cf', 'Configuration.xml') });
		assert.deepStrictEqual(designer, [path.join('w', 'src', 'cf', 'Subsystems')]);

		// В проекте EDT описание конфигурации лежит в своём каталоге, а подсистемы уровнем выше
		const edt = directoriesOf({ op: 'cf-md-subsystem-tree', configurationXml: path.join('w', 'ssl31', 'src', 'Configuration', 'Configuration.mdo') });
		assert.deepStrictEqual(edt, [path.join('w', 'ssl31', 'src', 'Subsystems')]);

		assert.deepStrictEqual(directoriesOf({ op: 'cf-md-object-get', objectXml: 'x.xml' }), []);
	});
});
