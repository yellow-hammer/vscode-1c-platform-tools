import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	getOvmRootDir,
	getOvmBinDir,
	getOpmBinaryCandidates,
	getOpmScriptPath,
} from '../../shared/ovmPaths';

suite('ovmPaths', () => {
	test('getOvmBinDir — каталог bin внутри корня OVM', () => {
		assert.strictEqual(getOvmBinDir(), path.join(getOvmRootDir(), 'bin'));
	});

	test('getOpmBinaryCandidates: обёртка opm без .exe в приоритете', () => {
		const candidates = getOpmBinaryCandidates(path.join('root', 'bin'));
		assert.ok(candidates.length > 0);
		if (process.platform === 'win32') {
			assert.strictEqual(path.basename(candidates[0]), 'opm.bat');
			assert.ok(candidates.every((c) => path.dirname(c) === path.join('root', 'bin')));
		} else {
			assert.deepStrictEqual(candidates, [path.join('root', 'bin', 'opm')]);
		}
	});

	test('getOpmScriptPath — opm.os в lib установки', () => {
		assert.strictEqual(
			getOpmScriptPath(path.join('install', 'root')),
			path.join('install', 'root', 'lib', 'opm', 'src', 'cmd', 'opm.os')
		);
	});
});
