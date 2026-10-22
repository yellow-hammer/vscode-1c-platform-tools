import * as assert from 'node:assert';
import { BASE_AUTUMN_FILE, BASE_ENV_FILE } from '../../shared/envProfiles';
import { SERVICE_FILES, serviceFilesWatchGlob } from '../../features/serviceFiles/registry';

suite('serviceFiles/registry', () => {
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
