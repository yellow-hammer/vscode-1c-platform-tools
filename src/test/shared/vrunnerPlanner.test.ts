import * as assert from 'node:assert';
import { planIntents, stripOverrideFlags, maskOverrideSecrets, stepsUseIbConnection, SettingsFileFormat } from '../../shared/vrunnerCli/planner';
import { parseVRunnerVersion } from '../../shared/vrunnerVersion';

const V2 = parseVRunnerVersion('2.6.1');
const V3 = parseVRunnerVersion('3.0.0');

/** Формат файлов настроек в тестах: по имени файла. */
const formatByName = (file: string): SettingsFileFormat => {
	if (file.includes('autumn')) {
		return 'v3';
	}
	if (file.includes('env')) {
		return 'v2';
	}
	return 'unknown';
};

/** Аргументы одной команды из плана. */
function planOne(context: Parameters<typeof planIntents>[1]): { args: string[]; notices: string[] } {
	const { steps, notices } = planIntents([{ kind: 'test.vanessa' }], context);
	return { args: steps[0], notices };
}

suite('vrunnerPlanner', () => {
	test('инкремент без обновления БД на 2.x снимается с замечанием', () => {
		const intent = { kind: 'cf.loadFromSrc' as const, src: 'src/cf', increment: true, updateDb: false };

		const { steps, notices } = planIntents([intent], {
			version: V2,
			overrideArgs: [],
			settingsFormat: formatByName,
		});

		assert.deepStrictEqual(steps, [
			['designer', '--additional', '/LoadConfigFromFiles src/cf -updateConfigDumpInfo'],
		]);
		assert.ok(
			notices.some((notice) => notice.includes('исходники загружены целиком')),
			'пользователь должен узнать, что инкремент не применён'
		);
	});

	test('на 3.x инкремент без обновления БД остаётся инкрементом', () => {
		const intent = { kind: 'cf.loadFromSrc' as const, src: 'src/cf', increment: true, updateDb: false };

		const { steps, notices } = planIntents([intent], {
			version: V3,
			overrideArgs: [],
			settingsFormat: formatByName,
		});

		assert.deepStrictEqual(steps, [['cf', 'load', '--increment', '--no-update-db', 'src/cf']]);
		assert.deepStrictEqual(notices, []);
	});

	test('активный профиль подставляется как --settings', () => {
		const { args } = planOne({
			version: V2,
			overrideArgs: [],
			activeSettingsFile: 'env.dev.json',
			settingsFormat: formatByName,
		});
		assert.ok(args.includes('--settings'));
		assert.ok(args.includes('env.dev.json'));
	});

	test('settingsFile вызова перекрывает активный профиль', () => {
		const { args } = planOne({
			version: V2,
			overrideArgs: [],
			activeSettingsFile: 'env.dev.json',
			settingsFile: 'env.init.json',
			settingsFormat: formatByName,
		});
		assert.ok(args.includes('env.init.json'));
		assert.ok(!args.includes('env.dev.json'));
	});

	test('settingsFile вызова отменяет временные параметры профиля', () => {
		const { args, notices } = planOne({
			version: V2,
			overrideArgs: ['--ibconnection', '/Fsome', '--v8version', '8.3.25'],
			settingsFile: 'env.init.json',
			settingsFormat: formatByName,
		});
		assert.ok(!args.includes('--ibconnection'));
		assert.ok(!args.includes('--v8version'));
		assert.ok(notices.some((notice) => notice.includes('не применены')));
	});

	test('явная строка подключения заменяет подключение из временных параметров', () => {
		const { args, notices } = planOne({
			version: V2,
			overrideArgs: ['--ibconnection', '/Fold', '--db-user', 'admin', '--v8version', '8.3.25'],
			explicitIbConnection: '/Fnew',
			settingsFormat: formatByName,
		});
		assert.ok(args.includes('--ibconnection'));
		assert.ok(args.includes('/Fnew'));
		assert.ok(!args.includes('/Fold'));
		assert.ok(!args.includes('--db-user'));
		// не связанные с подключением параметры остаются
		assert.ok(args.includes('--v8version'));
		assert.ok(notices.some((notice) => notice.includes('исключено подключение к ИБ')));
		assert.ok(notices.some((notice) => notice.includes('Подключение из вызова: /Fnew')));
	});

	test('файл настроек не отменяет явную строку подключения', () => {
		const { steps, notices } = planIntents(
			[{ kind: 'infobase.init' }],
			{
				version: V2,
				overrideArgs: ['--ibconnection', '/Fold', '--v8version', '8.3.25'],
				settingsFile: 'env.json',
				explicitIbConnection: '/F./build/out/ib_B',
				settingsFormat: formatByName,
			}
		);
		assert.ok(steps[0].includes('init-dev'));
		assert.ok(steps[0].includes('--settings'));
		assert.ok(steps[0].includes('env.json'));
		assert.ok(steps[0].includes('--ibconnection'));
		assert.ok(steps[0].includes('/F./build/out/ib_B'));
		assert.ok(!steps[0].includes('/Fold'));
		assert.ok(!steps[0].includes('--v8version'));
		assert.ok(stepsUseIbConnection(steps, '/F./build/out/ib_B'));
		assert.ok(notices.some((notice) => notice.includes('Подключение из вызова')));
	});

	test('путь с пробелом в строке подключения закавычивается', () => {
		const connection = String.raw`/FC:\каталог с пробелом\ib`;
		const { steps } = planIntents(
			[{ kind: 'infobase.init' }],
			{ version: V2, overrideArgs: [], explicitIbConnection: connection, settingsFormat: formatByName }
		);
		assert.ok(steps[0].includes(String.raw`/F"C:\каталог с пробелом\ib"`));
		assert.ok(stepsUseIbConnection(steps, connection));
	});

	test('уже заданное подключение не дублируется', () => {
		const { steps } = planIntents(
			[{ kind: 'infobase.updateDb', common: ['--ibconnection', '/Falready'] }],
			{ version: V2, overrideArgs: [], explicitIbConnection: '/Fnew', settingsFormat: formatByName }
		);
		const flags = steps[0].filter((arg) => arg === '--ibconnection');
		assert.strictEqual(flags.length, 1);
		assert.ok(steps[0].includes('/Falready'));
		assert.ok(!steps[0].includes('/Fnew'));
	});

	test('на 3.x создание базы получает строку подключения', () => {
		const { steps } = planIntents(
			[{ kind: 'infobase.init' }],
			{ version: V3, overrideArgs: [], explicitIbConnection: '/F./build/out/ib_B', settingsFormat: formatByName }
		);
		assert.ok(steps[0].includes('infobase'));
		assert.ok(steps[0].includes('init'));
		assert.ok(stepsUseIbConnection(steps, '/F./build/out/ib_B'));
	});

	test('проверка EDT на 3.x не принимает строку подключения', () => {
		const { steps, notices } = planIntents(
			[{ kind: 'validate.edt' }],
			{ version: V3, overrideArgs: [], explicitIbConnection: '/F./build/ib', settingsFormat: formatByName }
		);
		assert.strictEqual(stepsUseIbConnection(steps, '/F./build/ib'), false);
		assert.ok(!notices.some((notice) => notice.includes('Подключение из вызова')));
	});

	test('временные параметры применяются, когда параметров вызова нет', () => {
		const { args, notices } = planOne({
			version: V2,
			overrideArgs: ['--v8version', '8.3.25'],
			settingsFormat: formatByName,
		});
		assert.ok(args.includes('--v8version'));
		assert.ok(notices.some((notice) => notice.includes('Применены перекрытия профиля')));
	});

	test('пароль в замечании маскируется', () => {
		const { notices } = planOne({
			version: V2,
			overrideArgs: ['--db-pwd', 'секрет'],
			settingsFormat: formatByName,
		});
		const applied = notices.find((notice) => notice.includes('Применены перекрытия профиля'));
		assert.ok(applied);
		assert.ok(!applied.includes('секрет'));
	});

	test('файл настроек 3.x не передаётся vanessa-runner 2.x', () => {
		const { args, notices } = planOne({
			version: V2,
			overrideArgs: [],
			settingsFile: 'autumn-properties.json',
			settingsFormat: formatByName,
		});
		assert.ok(!args.includes('--settings'));
		assert.ok(notices.some((notice) => notice.includes('3.x не передан')));
	});

	test('файл настроек 2.x не передаётся vanessa-runner 3.x', () => {
		const { args, notices } = planOne({
			version: V3,
			overrideArgs: [],
			settingsFile: 'env.json',
			settingsFormat: formatByName,
		});
		assert.ok(!args.includes('--settings'));
		assert.ok(notices.some((notice) => notice.includes('2.x не передан')));
	});

	test('файл настроек своего формата передаётся', () => {
		const v3Plan = planOne({
			version: V3,
			overrideArgs: [],
			settingsFile: 'autumn-properties.json',
			settingsFormat: formatByName,
		});
		assert.ok(v3Plan.args.includes('autumn-properties.json'));

		const v2Plan = planOne({
			version: V2,
			overrideArgs: [],
			settingsFile: 'env.json',
			settingsFormat: formatByName,
		});
		assert.ok(v2Plan.args.includes('env.json'));
	});

	test('--settings из намерения не дублируется', () => {
		const { steps } = planIntents(
			[{ kind: 'test.vanessa', common: ['--settings', 'env.custom.json'] }],
			{ version: V2, overrideArgs: [], activeSettingsFile: 'env.json', settingsFormat: formatByName }
		);
		const settingsCount = steps[0].filter((arg) => arg === '--settings').length;
		assert.strictEqual(settingsCount, 1);
		assert.ok(steps[0].includes('env.custom.json'));
	});

	test('несколько намерений дают несколько команд', () => {
		const { steps } = planIntents(
			[{ kind: 'test.vanessa' }, { kind: 'test.xunit', testsPath: 'tests/epf' }],
			{ version: V2, overrideArgs: [], settingsFormat: formatByName }
		);
		assert.strictEqual(steps.length, 2);
	});

	test('stripOverrideFlags убирает флаг вместе со значением', () => {
		const result = stripOverrideFlags(['--a', '1', '--b', '2', '--c', '3'], ['--b']);
		assert.deepStrictEqual(result, ['--a', '1', '--c', '3']);
	});

	test('maskOverrideSecrets маскирует только пароль', () => {
		const result = maskOverrideSecrets(['--db-user', 'admin', '--db-pwd', 'секрет']);
		assert.deepStrictEqual(result, ['--db-user', 'admin', '--db-pwd', '••••']);
	});
});
