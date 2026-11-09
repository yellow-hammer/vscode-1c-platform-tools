import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	PlatformServerManager,
	serverProjectSwitchQuestion,
	type PublicationSelection,
} from '../../features/launch/platformServerManager';
import { parseServerConfigParams } from '../../shared/ibsrvPublication';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { projectMemento, SERVER_PUBLICATION_STATE } from '../../shared/projectState';
import { runWithProject, sameProjectRoot } from '../../shared/workspaceProjects';
import { createMockExtensionContext } from '../fixtures/mocks/vscodeMocks';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'workspaceProjects');
const FIRST = path.join(FIXTURES, 'проект');
const SECOND = path.join(FIXTURES, 'две-конфигурации');

suite('автономный сервер в проектах', () => {
	let manager: PlatformServerManager;

	suiteSetup(() => {
		manager = new PlatformServerManager(VRunnerManager.getInstance(), createMockExtensionContext(FIRST));
	});

	suiteTeardown(async () => {
		await projectMemento(FIRST).update(SERVER_PUBLICATION_STATE, undefined);
	});

	test('запуск для другого проекта спрашивает про сервер прежнего', () => {
		assert.strictEqual(
			serverProjectSwitchQuestion('X', 'Y'),
			'Автономный сервер проекта X запущен. Остановить его и запустить для Y?'
		);
	});

	test('выбор публикации у каждого проекта свой', async () => {
		const selection: PublicationSelection = { odata: false, webAll: false, web: ['Обмен'], httpAll: true, http: [] };
		await projectMemento(FIRST).update(SERVER_PUBLICATION_STATE, selection);

		assert.deepStrictEqual(manager.getPublicationSelection(FIRST), selection);
		assert.deepStrictEqual(manager.getPublicationSelection(SECOND), {
			odata: true,
			webAll: true,
			web: [],
			httpAll: true,
			http: [],
		});
	});

	test('остановленный сервер не принадлежит проекту и базу не держит', () => {
		assert.strictEqual(manager.state, 'stopped');
		assert.strictEqual(manager.ownerRoot, undefined);
		assert.strictEqual(manager.infobaseHolder().heldInfobase(), undefined);
	});

	test('смена профиля не создаёт конфиг публикации, а существующий переводит только на другую базу', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-publication-'));
		const profileChanged = () => runWithProject(root, () => manager.onActiveProfileChanged());
		try {
			await profileChanged();
			assert.strictEqual(fs.existsSync(path.join(root, 'build')), false);

			const config = path.join(root, 'build', 'out', 'ibsrv', 'publication.yaml');
			const infobase = path.join(root, 'build', 'ib');
			const edited = `server:\n  address: localhost\n  port: 9000\ndatabase:\n  path: ${infobase}\n# ручная правка\n`;
			fs.mkdirSync(path.dirname(config), { recursive: true });
			fs.writeFileSync(config, edited);
			await profileChanged();
			assert.strictEqual(fs.readFileSync(config, 'utf8'), edited);

			fs.writeFileSync(config, edited.replace(infobase, path.join(root, 'другая')));
			await profileChanged();
			const published = parseServerConfigParams(fs.readFileSync(config, 'utf8'));
			assert.ok(published.dbPath !== undefined && sameProjectRoot(published.dbPath, infobase), String(published.dbPath));
			assert.strictEqual(published.port, 9000);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
