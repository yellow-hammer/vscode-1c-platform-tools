import * as assert from 'node:assert';
import {
	parseVRunnerVersion,
	parseVRunnerVersionFromOpmMetadata,
	compareVRunnerVersions,
	isAtLeast,
	supportsFeature,
} from '../../shared/vrunnerVersion';

suite('vrunnerVersion', () => {
	test('parseVRunnerVersion: чистый вывод `vrunner version`', () => {
		const v = parseVRunnerVersion('2.6.0');
		assert.ok(v);
		assert.strictEqual(v.major, 2);
		assert.strictEqual(v.minor, 6);
		assert.strictEqual(v.patch, 0);
		assert.strictEqual(v.prerelease, undefined);
		assert.strictEqual(v.raw, '2.6.0');
	});

	test('parseVRunnerVersion: предрелиз 3.0.0-rc3', () => {
		const v = parseVRunnerVersion('3.0.0-rc3');
		assert.ok(v);
		assert.strictEqual(v.major, 3);
		assert.strictEqual(v.minor, 0);
		assert.strictEqual(v.patch, 0);
		assert.strictEqual(v.prerelease, 'rc3');
	});

	test('parseVRunnerVersion: версия среди лишнего текста', () => {
		const v = parseVRunnerVersion('vanessa-runner version 2.6.0\n');
		assert.ok(v);
		assert.strictEqual(v.raw, '2.6.0');
	});

	test('parseVRunnerVersion: мусор → undefined', () => {
		assert.strictEqual(parseVRunnerVersion(''), undefined);
		assert.strictEqual(parseVRunnerVersion('no version here'), undefined);
	});

	test('compareVRunnerVersions: по major.minor.patch', () => {
		const a = parseVRunnerVersion('2.6.0')!;
		const b = parseVRunnerVersion('3.0.0')!;
		assert.strictEqual(compareVRunnerVersions(a, b), -1);
		assert.strictEqual(compareVRunnerVersions(b, a), 1);
		assert.strictEqual(compareVRunnerVersions(a, parseVRunnerVersion('2.6.0')!), 0);
	});

	test('compareVRunnerVersions: предрелиз не влияет на сравнение', () => {
		const rc = parseVRunnerVersion('3.0.0-rc3')!;
		const release = parseVRunnerVersion('3.0.0')!;
		assert.strictEqual(compareVRunnerVersions(rc, release), 0);
	});

	test('isAtLeast: предрелиз 3.0 удовлетворяет >= 3.0.0', () => {
		assert.strictEqual(isAtLeast(parseVRunnerVersion('3.0.0-rc3')!, '3.0.0'), true);
		assert.strictEqual(isAtLeast(parseVRunnerVersion('2.6.0')!, '3.0.0'), false);
		assert.strictEqual(isAtLeast(parseVRunnerVersion('3.1.0')!, '3.0.0'), true);
	});

	test('supportsFeature: ibsrv-возможности только для 3.x', () => {
		const v26 = parseVRunnerVersion('2.6.0')!;
		const v30rc = parseVRunnerVersion('3.0.0-rc3')!;
		assert.strictEqual(supportsFeature(v26, 'ibsrvAttach'), false);
		assert.strictEqual(supportsFeature(v26, 'cli3'), false);
		assert.strictEqual(supportsFeature(v30rc, 'ibsrv'), true);
		assert.strictEqual(supportsFeature(v30rc, 'ibsrvAttach'), true);
		assert.strictEqual(supportsFeature(v30rc, 'cli3'), true);
	});

	test('parseVRunnerVersionFromOpmMetadata: извлекает <version>', () => {
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<opm-metadata xmlns="http://oscript.io/schemas/opm-metadata/1.0">
    <name>vanessa-runner</name>
    <version>2.6.0</version>
    <engine-version>1.9.2</engine-version>
</opm-metadata>`;
		const v = parseVRunnerVersionFromOpmMetadata(xml);
		assert.ok(v);
		assert.strictEqual(v.major, 2);
		assert.strictEqual(v.minor, 6);
		assert.strictEqual(v.patch, 0);
	});

	test('parseVRunnerVersionFromOpmMetadata: битый xml → undefined', () => {
		assert.strictEqual(parseVRunnerVersionFromOpmMetadata(''), undefined);
		assert.strictEqual(parseVRunnerVersionFromOpmMetadata('<not-opm/>'), undefined);
	});
});
