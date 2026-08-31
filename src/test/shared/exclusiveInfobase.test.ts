import * as assert from 'node:assert';
import {
	anyNeedsExclusiveInfobase,
	infobaseHolder,
	keepsInfobaseAfterRun,
	needsExclusiveInfobase,
	registerInfobaseHolder,
} from '../../shared/exclusiveInfobase';

suite('монопольный доступ к информационной базе', () => {
	teardown(() => {
		registerInfobaseHolder(undefined);
	});

	test('база нужна командам, которые её открывают', () => {
		const kinds = [
			'cf.loadFromSrc', 'cf.dumpIbToSrc', 'cfe.loadFromSrc', 'infobase.updateDb',
			'infobase.listExtensions', 'cfe.decompileCfeFile', 'epf.build', 'epf.decompile',
			'run.designer', 'run.enterprise', 'test.vanessa', 'test.xunit', 'validate.syntaxCheck',
		] as const;
		for (const kind of kinds) {
			assert.ok(needsExclusiveInfobase(kind), `${kind} должен требовать базу`);
		}
	});

	test('сборке и разбору файлов база не нужна', () => {
		for (const kind of ['cf.build', 'cf.decompileFile', 'cfe.buildCfe', 'session.lock'] as const) {
			assert.ok(!needsExclusiveInfobase(kind), `${kind} обходится без базы`);
		}
	});

	test('запуск без ожидания оставляет базу занятой', () => {
		assert.ok(keepsInfobaseAfterRun([{ kind: 'run.designer', noWait: true }]));
		assert.ok(!keepsInfobaseAfterRun([{ kind: 'run.designer', additional: '/DumpIB' }]));
		assert.ok(!keepsInfobaseAfterRun([{ kind: 'infobase.updateDb' }]));
	});

	test('цепочка требует базу, если её требует хоть один шаг', () => {
		assert.ok(anyNeedsExclusiveInfobase([{ kind: 'cf.build', src: 'src/cf', out: 'build' }, { kind: 'infobase.updateDb' }]));
		assert.ok(!anyNeedsExclusiveInfobase([{ kind: 'cf.build', src: 'src/cf', out: 'build' }]));
	});

	test('держатель регистрируется и забывается', () => {
		assert.strictEqual(infobaseHolder(), undefined);
		const holder = {
			label: 'Проба',
			isHolding: () => true,
			release: async () => true,
			restore: async () => undefined,
		};
		registerInfobaseHolder(holder);
		assert.strictEqual(infobaseHolder(), holder);
		registerInfobaseHolder(undefined);
		assert.strictEqual(infobaseHolder(), undefined);
	});
});
