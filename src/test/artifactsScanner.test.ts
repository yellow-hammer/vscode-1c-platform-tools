import * as assert from 'node:assert';
import {
	classifyXmlArtifactHead,
	edtNameFromHead,
	isEdtExtensionHead,
} from '../features/artifacts/artifactsScanner';

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

suite('артефакты: раскладка EDT', () => {
	test('конфигурация и расширение различаются по Configuration.mdo', () => {
		const configuration = [
			'<mdclass:Configuration uuid="46c7c1d0-b04d-4295-9b04-ae3207c18d29">',
			'  <name>БиблиотекаСтандартныхПодсистемДемо</name>',
			'</mdclass:Configuration>',
		].join('\n');
		const extension = [
			'<mdclass:Configuration uuid="2fd73213-5b64-4002-b842-6e6dbd6ab9fa">',
			'  <name>_ДемоРасширение</name>',
			'  <namePrefix>_Демо</namePrefix>',
			'  <objectBelonging>Adopted</objectBelonging>',
			'</mdclass:Configuration>',
		].join('\n');

		assert.strictEqual(isEdtExtensionHead(configuration), false);
		assert.strictEqual(isEdtExtensionHead(extension), true);
		assert.strictEqual(edtNameFromHead(configuration), 'БиблиотекаСтандартныхПодсистемДемо');
		assert.strictEqual(edtNameFromHead(extension), '_ДемоРасширение');
	});
});
