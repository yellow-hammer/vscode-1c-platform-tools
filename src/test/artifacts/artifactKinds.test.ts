import * as assert from 'node:assert';
import { binaryArtifactKind } from '../../features/artifacts/artifactKinds';

suite('artifactKinds: вид бинарного файла 1С', () => {
	test('вид определяется по расширению без учёта регистра', () => {
		assert.strictEqual(binaryArtifactKind('C:\\build\\1Cv8.CF')?.label, 'Конфигурация');
		assert.strictEqual(binaryArtifactKind('build/out/Ext.cfe')?.icon, 'extension.svg');
		assert.strictEqual(
			binaryArtifactKind('build/epf/Обработка.epf')?.decompileCommand,
			'1c-platform-tools.artifacts.decompileProcessor'
		);
		assert.strictEqual(binaryArtifactKind('build/erf/Отчёт.erf')?.label, 'Внешний отчёт');
		assert.strictEqual(binaryArtifactKind('build/out/ospx/пакет-0.1.0.ospx')?.icon, 'package.svg');
		assert.strictEqual(binaryArtifactKind('build/out/ospx/пакет-0.1.0.ospx')?.install, true);
		assert.strictEqual(binaryArtifactKind('build/out/ospx/пакет-0.1.0.ospx')?.decompileCommand, undefined);
	});

	test('чужие файлы не считаются файлами 1С', () => {
		assert.strictEqual(binaryArtifactKind('build/1Cv8.dt'), undefined);
		assert.strictEqual(binaryArtifactKind('src/cf'), undefined);
	});
});
