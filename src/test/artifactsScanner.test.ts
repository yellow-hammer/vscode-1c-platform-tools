import * as assert from 'node:assert';
import { classifyXmlArtifactHead } from '../artifactsScanner';

suite('artifactsScanner.classifyXmlArtifactHead', () => {
	test('определяет корень внешней обработки', () => {
		const xml = '<?xml version="1.0"?><ExternalDataProcessor xmlns="...">';
		assert.strictEqual(classifyXmlArtifactHead(xml), 'processor');
	});

	test('определяет корень внешнего отчёта', () => {
		const xml = '<?xml version="1.0"?><ExternalReport foo="bar">';
		assert.strictEqual(classifyXmlArtifactHead(xml), 'report');
	});

	test('возвращает null для прочего XML', () => {
		assert.strictEqual(classifyXmlArtifactHead('<MetaDataObject'), null);
		assert.strictEqual(classifyXmlArtifactHead(''), null);
	});

	test('приоритет обработки над отчётом при обоих маркерах', () => {
		const xml = '<ExternalDataProcessor><ExternalReport';
		assert.strictEqual(classifyXmlArtifactHead(xml), 'processor');
	});
});
