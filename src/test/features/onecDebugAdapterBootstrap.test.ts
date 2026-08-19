import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	adapterAssetRegexes,
	adapterCacheMatchesPlatform,
	adapterHostName,
	adapterRid,
	resolveAdapterRuntime,
	runtimeFromFile,
} from '../../features/debug/onecDebugAdapterBootstrap';
import { findAsset } from '../../shared/githubReleaseLoader';

/** Имена asset'ов релиза адаптера с самостоятельными сборками. */
const RELEASE_ASSETS = [
	{ name: 'onec-debug-adapter-v0.3.0.zip', browser_download_url: 'u0' },
	{ name: 'onec-debug-adapter-win-x64-v0.3.0.zip', browser_download_url: 'u1' },
	{ name: 'onec-debug-adapter-linux-x64-v0.3.0.zip', browser_download_url: 'u2' },
	{ name: 'onec-debug-adapter-osx-x64-v0.3.0.zip', browser_download_url: 'u3' },
	{ name: 'onec-debug-adapter-osx-arm64-v0.3.0.zip', browser_download_url: 'u4' },
];

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Раскладка распакованного релиза: сборка адаптера с нативным хостом и runtimeconfig.json. */
function releaseLayout(prefix: string, selfContained: boolean): { root: string; dir: string } {
	const root = tempDir(prefix);
	const dir = path.join(root, 'onec-debug-adapter');
	fs.mkdirSync(dir);
	fs.writeFileSync(path.join(dir, 'OnecDebugAdapter.dll'), '');
	// Нативный хост лежит в обеих сборках: в обычной он требует установленного .NET.
	fs.writeFileSync(path.join(dir, adapterHostName()), '');
	const runtimeOptions = selfContained
		? { tfm: 'net8.0', includedFrameworks: [{ name: 'Microsoft.NETCore.App', version: '8.0.30' }] }
		: { tfm: 'net8.0', framework: { name: 'Microsoft.NETCore.App', version: '8.0.0' } };
	fs.writeFileSync(path.join(dir, 'OnecDebugAdapter.runtimeconfig.json'), JSON.stringify({ runtimeOptions }));
	return { root, dir };
}

suite('onecDebugAdapterBootstrap', () => {
	test('платформа и разрядность дают RID сборки', () => {
		assert.strictEqual(adapterRid('win32', 'x64'), 'win-x64');
		assert.strictEqual(adapterRid('win32', 'arm64'), 'win-x64');
		assert.strictEqual(adapterRid('darwin', 'arm64'), 'osx-arm64');
		assert.strictEqual(adapterRid('darwin', 'x64'), 'osx-x64');
		assert.strictEqual(adapterRid('linux', 'x64'), 'linux-x64');
	});

	test('для платформы без сборки RID не определяется', () => {
		assert.strictEqual(adapterRid('linux', 'arm64'), undefined);
		assert.strictEqual(adapterRid('win32', 'ia32'), undefined);
		assert.strictEqual(adapterRid('freebsd', 'x64'), undefined);
	});

	test('сборка под систему выбирается раньше универсального архива', () => {
		assert.strictEqual(findAsset(RELEASE_ASSETS, adapterAssetRegexes('win-x64'))?.name,
			'onec-debug-adapter-win-x64-v0.3.0.zip');
		assert.strictEqual(findAsset(RELEASE_ASSETS, adapterAssetRegexes('osx-arm64'))?.name,
			'onec-debug-adapter-osx-arm64-v0.3.0.zip');
	});

	test('без сборки под систему берётся универсальный архив', () => {
		assert.strictEqual(findAsset(RELEASE_ASSETS, adapterAssetRegexes(undefined))?.name,
			'onec-debug-adapter-v0.3.0.zip');
	});

	test('в релизе без самостоятельных сборок остаётся универсальный архив', () => {
		const oldRelease = [{ name: 'onec-debug-adapter-v0.2.0.zip', browser_download_url: 'u' }];
		assert.strictEqual(findAsset(oldRelease, adapterAssetRegexes('win-x64'))?.name, 'onec-debug-adapter-v0.2.0.zip');
	});

	test('сборка под чужую платформу не сходит за универсальный архив', () => {
		const onlyLinux = [{ name: 'onec-debug-adapter-linux-x64-v0.3.0.zip', browser_download_url: 'u' }];
		assert.strictEqual(findAsset(onlyLinux, adapterAssetRegexes('win-x64')), undefined);
		assert.strictEqual(findAsset(onlyLinux, adapterAssetRegexes(undefined)), undefined);
	});

	test('универсальный архив узнаётся и по предварительному тегу', () => {
		const rc = [{ name: 'onec-debug-adapter-v0.3.0-rc.1.zip', browser_download_url: 'u' }];
		assert.strictEqual(findAsset(rc, adapterAssetRegexes(undefined))?.name, 'onec-debug-adapter-v0.3.0-rc.1.zip');
	});

	test('в самостоятельной сборке запускается нативный хост', () => {
		const { root, dir } = releaseLayout('1cpt-dap-sc-', true);

		const runtime = resolveAdapterRuntime(root);
		assert.strictEqual(runtime?.command, path.join(dir, adapterHostName()));
		assert.deepStrictEqual(runtime?.args, []);
	});

	test('в универсальном архиве запуск идёт через dotnet, а не через чужой хост', () => {
		const { root, dir } = releaseLayout('1cpt-dap-portable-', false);

		const runtime = resolveAdapterRuntime(root);
		assert.strictEqual(runtime?.command, 'dotnet');
		assert.deepStrictEqual(runtime?.args, [path.join(dir, 'OnecDebugAdapter.dll')]);
	});

	test('без runtimeconfig.json запуск идёт через dotnet', () => {
		const root = tempDir('1cpt-dap-noconfig-');
		const dir = path.join(root, 'onec-debug-adapter');
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, 'OnecDebugAdapter.dll'), '');
		fs.writeFileSync(path.join(dir, adapterHostName()), '');

		assert.strictEqual(resolveAdapterRuntime(root)?.command, 'dotnet');
	});

	test('пустой каталог релиза не даёт команды запуска', () => {
		assert.strictEqual(resolveAdapterRuntime(tempDir('1cpt-dap-empty-')), undefined);
	});

	test('кэш с native-библиотеками чужой ОС отбрасывается', () => {
		const { root, dir } = releaseLayout('1cpt-dap-wrongos-', true);
		fs.writeFileSync(path.join(dir, 'libhostpolicy.so'), '');

		assert.strictEqual(adapterCacheMatchesPlatform(root, 'win32'), false);
		assert.strictEqual(adapterCacheMatchesPlatform(root, 'linux'), true);
	});

	test('кэш без чужих native-библиотек подходит', () => {
		const { root } = releaseLayout('1cpt-dap-nativeos-', true);
		assert.strictEqual(adapterCacheMatchesPlatform(root, 'win32'), true);
	});

	test('свой путь к адаптеру: dll через dotnet, остальное напрямую', () => {
		const root = tempDir('1cpt-dap-own-');
		const dll = path.join(root, 'OnecDebugAdapter.dll');
		const host = path.join(root, adapterHostName());
		fs.writeFileSync(dll, '');
		fs.writeFileSync(host, '');

		assert.deepStrictEqual(runtimeFromFile(dll), { command: 'dotnet', args: [dll] });
		assert.deepStrictEqual(runtimeFromFile(host), { command: host, args: [] });
	});
});
