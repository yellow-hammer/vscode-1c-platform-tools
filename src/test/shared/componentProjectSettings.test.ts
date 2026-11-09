import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ZipFile } from 'yazl';
import { ensureOnecDebugAdapter } from '../../features/debug/onecDebugAdapterBootstrap';
import { edtWorkspaceDir, readEdtSettings } from '../../features/edt/edtRunner';
import { ensureMdSparrowRuntime } from '../../features/metadata/mdSparrowBootstrap';
import { projectPlatformRoots } from '../../shared/platformSettings';
import { runWithProject, sameProjectRoot } from '../../shared/workspaceProjects';

type GetConfiguration = typeof vscode.workspace.getConfiguration;

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

/** Настройки компонентов, платформы и EDT, которые читаются для проекта. */
const PROJECT_SETTING = /^1c-platform-tools\.(components\.(path|autoload)|edt|platform)\./;

suite('область настроек компонентов и EDT', () => {
	test('настройки путей, автозагрузки компонентов, платформы и EDT объявлены с областью resource', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
			contributes: { configuration: { properties: Record<string, { scope?: string }> }[] };
		};
		const scopes = new Map<string, string | undefined>();
		for (const section of pkg.contributes.configuration) {
			for (const [key, schema] of Object.entries(section.properties)) {
				if (PROJECT_SETTING.test(key)) {
					scopes.set(key, schema.scope);
				}
			}
		}

		for (const key of [
			'1c-platform-tools.components.path.metadataJar',
			'1c-platform-tools.components.autoload.metadataJar',
			'1c-platform-tools.components.path.adapter',
			'1c-platform-tools.components.autoload.adapter',
			'1c-platform-tools.platform.path',
			'1c-platform-tools.edt.version',
			'1c-platform-tools.edt.workspace',
			'1c-platform-tools.edt.java',
			'1c-platform-tools.edt.vmargs',
		]) {
			assert.ok(scopes.has(key), `нет настройки ${key}`);
		}
		for (const [key, scope] of scopes) {
			assert.strictEqual(scope, 'resource', key);
		}
	});
});

suite('настройки компонентов и EDT читаются для проекта вызова', () => {
	const workspace = vscode.workspace as unknown as { getConfiguration: GetConfiguration };
	const original = workspace.getConfiguration;
	let dir: string;
	let first: string;
	let second: string;
	let context: vscode.ExtensionContext;
	let values: Map<string, Record<string, unknown>>;
	let scopes: string[];

	suiteSetup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'настройки-проектов-'));
		first = path.join(dir, 'первый');
		second = path.join(dir, 'второй');
		fs.mkdirSync(first);
		fs.mkdirSync(second);
		context = { globalStorageUri: vscode.Uri.file(path.join(dir, 'хранилище')) } as vscode.ExtensionContext;
	});

	suiteTeardown(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	setup(() => {
		values = new Map();
		scopes = [];
		workspace.getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope | null) => {
			const config = original(section, scope);
			if (section !== '1c-platform-tools' || !(scope instanceof vscode.Uri)) {
				return config;
			}
			const own = [...values].find(([root]) => sameProjectRoot(scope.fsPath, root))?.[1];
			if (own === undefined) {
				return config;
			}
			scopes.push(scope.fsPath);
			return {
				get: (key: string, defaultValue?: unknown) => (key in own ? own[key] : config.get(key, defaultValue)),
				has: (key: string) => config.has(key),
				inspect: (key: string) => config.inspect(key),
				update: config.update.bind(config),
			} as vscode.WorkspaceConfiguration;
		}) as GetConfiguration;
	});

	teardown(() => {
		workspace.getConfiguration = original;
	});

	/** Пустой файл в каталоге проекта. */
	function touch(root: string, name: string): string {
		const file = path.join(root, name);
		fs.writeFileSync(file, '');
		return file;
	}

	/** JAR md-sparrow: требуемая Java объявлена в манифесте. */
	async function writeJar(root: string, name: string): Promise<string> {
		const file = path.join(root, name);
		const zip = new ZipFile();
		zip.addBuffer(
			Buffer.from('Manifest-Version: 1.0\r\nX-Required-Java-Version: 25\r\n\r\n'),
			'META-INF/MANIFEST.MF'
		);
		zip.end();
		await new Promise<void>((resolve, reject) => {
			const out = fs.createWriteStream(file);
			zip.outputStream.pipe(out).on('close', resolve).on('error', reject);
		});
		return file;
	}

	/** Области чтения совпадают с корнями проектов. */
	function assertScopes(...roots: string[]): void {
		assert.ok(scopes.length > 0, 'настройки проекта не читались');
		for (const scope of scopes) {
			assert.ok(roots.some((root) => sameProjectRoot(scope, root)), scope);
		}
	}

	test('md-sparrow запускается jar и java из настроек проекта', async () => {
		const firstJar = await writeJar(first, 'md-sparrow-first-all.jar');
		const secondJar = await writeJar(second, 'md-sparrow-second-all.jar');
		values.set(first, { 'components.path.metadataJar': firstJar, 'components.path.java': 'java-первого' });
		values.set(second, { 'components.path.metadataJar': secondJar, 'components.path.java': 'java-второго' });

		const [a, b] = await Promise.all([ensureMdSparrowRuntime(context, first), ensureMdSparrowRuntime(context, second)]);
		const current = await runWithProject(second, () => ensureMdSparrowRuntime(context));

		assert.deepStrictEqual([a.jarPath, a.java], [firstJar, 'java-первого']);
		assert.deepStrictEqual([b.jarPath, b.java], [secondJar, 'java-второго']);
		assert.deepStrictEqual([current.jarPath, current.java], [secondJar, 'java-второго']);
		assertScopes(first, second);
	});

	test('адаптер отладки берётся из настроек проекта', async () => {
		const firstDll = touch(first, 'OnecDebugAdapter.dll');
		const secondDll = touch(second, 'OnecDebugAdapter.dll');
		values.set(first, { 'components.path.adapter': firstDll });
		values.set(second, { 'components.path.adapter': secondDll });

		const runtime = await ensureOnecDebugAdapter(context, first);
		const current = await runWithProject(second, () => ensureOnecDebugAdapter(context));

		assert.deepStrictEqual(runtime.args, [firstDll]);
		assert.deepStrictEqual(current.args, [secondDll]);
		assertScopes(first, second);
	});

	test('каталог установки платформы читается для проекта команды', async () => {
		const firstPlatform = path.join(first, '1cv8');
		const secondPlatform = path.join(second, '1cv8');
		values.set(first, { 'platform.path': firstPlatform });
		values.set(second, { 'platform.path': secondPlatform });

		const roots = projectPlatformRoots(first);
		const current = await runWithProject(second, async () => projectPlatformRoots());

		assert.deepStrictEqual(roots, [firstPlatform]);
		assert.deepStrictEqual(current, [secondPlatform]);
		assertScopes(first, second);
	});

	test('настройки EDT читаются для проекта команды', async () => {
		values.set(first, {
			'edt.version': '2026.1',
			'edt.workspace': 'едт',
			'edt.vmargs': ['-Xmx8g'],
			'edt.java': 'C:/Java/bin',
		});
		values.set(second, { 'edt.version': '2025.2', 'edt.timeoutSeconds': 7200 });

		const settings = readEdtSettings(first);
		const current = await runWithProject(second, async () => readEdtSettings());

		assert.deepStrictEqual(
			[settings.version, settings.workspace, settings.vmargs, settings.java],
			['2026.1', 'едт', ['-Xmx8g'], 'C:/Java/bin']
		);
		assert.deepStrictEqual([current.version, current.timeoutSeconds], ['2025.2', 7200]);
		assert.strictEqual(edtWorkspaceDir(first, 'build'), path.join(first, 'едт'));
		assertScopes(first, second);
	});
});
