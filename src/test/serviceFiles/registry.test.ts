import * as assert from 'node:assert';
import { BASE_AUTUMN_FILE, BASE_ENV_FILE } from '../../shared/envProfiles';
import { SERVICE_FILES, serviceFilesWatchGlob } from '../../features/serviceFiles/registry';

suite('serviceFiles/registry', () => {
	test('launchProfile по умолчанию — схема 3.x', () => {
		const launch = SERVICE_FILES.find((spec) => spec.id === 'launchProfile');
		assert.ok(launch);
		assert.strictEqual(launch.relPath, BASE_AUTUMN_FILE);
	});

	test('serviceFilesWatchGlob: реестр и оба базовых файла профиля', () => {
		const glob = serviceFilesWatchGlob();
		assert.ok(glob.startsWith('{') && glob.endsWith('}'));
		for (const spec of SERVICE_FILES) {
			assert.ok(glob.includes(spec.relPath), `нет ${spec.relPath}`);
		}
		assert.ok(glob.includes(BASE_ENV_FILE));
		assert.ok(glob.includes(BASE_AUTUMN_FILE));
	});
});
