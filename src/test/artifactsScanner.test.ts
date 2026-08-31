import * as assert from 'node:assert';
import {
	classifyXmlArtifactHead,
	edtNameFromHead,
	isEdtExtensionHead,
	scanArtifacts,
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

	test('корень EDT опознаётся с префиксом пространства имён', () => {
		const processor = '<?xml version="1.0"?><mdclass:ExternalDataProcessor xmlns:mdclass="..." uuid="1">';
		const report = '<?xml version="1.0"?><mdclass:ExternalReport xmlns:mdclass="..." uuid="2">';

		assert.strictEqual(classifyXmlArtifactHead(processor), 'processor');
		assert.strictEqual(classifyXmlArtifactHead(report), 'report');
	});

	test('похожее имя тега не считается корнем', () => {
		assert.strictEqual(classifyXmlArtifactHead('<ExternalDataProcessors>'), null);
		assert.strictEqual(classifyXmlArtifactHead('<mdclass:ExternalReportSettings>'), null);
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

suite('артефакты: скан рабочей области', () => {
	// Скан идёт по всему репозиторию, поэтому он один на весь набор.
	let result: Awaited<ReturnType<typeof scanArtifacts>>;

	suiteSetup(async function () {
		this.timeout(60_000);
		result = await scanArtifacts();
	});

	test('внешние обработки и отчёты EDT попадают в результат', () => {
		const processors = result.processors.filter((artifact) => artifact.kind === 'source');
		const reports = result.reports.filter((artifact) => artifact.kind === 'source');

		assert.ok(
			processors.some((artifact) => artifact.name === 'ТестоваяВнешняяОбработка'),
			`обработка из проекта EDT не найдена: ${processors.map((a) => a.name).join(', ')}`
		);
		assert.ok(
			reports.some((artifact) => artifact.name === 'ТестовыйВнешнийОтчет'),
			`отчёт из проекта EDT не найден: ${reports.map((a) => a.name).join(', ')}`
		);
	});

	test('конфигурации и расширения EDT названы по метаданным', () => {
		assert.ok(
			result.configurations.some((artifact) => artifact.name === 'БиблиотекаСтандартныхПодсистемДемо'),
			`конфигурация EDT не найдена: ${result.configurations.map((a) => a.name).join(', ')}`
		);
		assert.ok(
			result.extensions.some((artifact) => artifact.name === '_ДемоРасширение'),
			`расширение EDT не найдено: ${result.extensions.map((a) => a.name).join(', ')}`
		);
	});
});
