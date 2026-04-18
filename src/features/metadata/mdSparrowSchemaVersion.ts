/**
 * Флаг `-v` для md-sparrow из атрибута `version` корневого `MetaDataObject` в `Configuration.xml`.
 * @module mdSparrowSchemaVersion
 */

/** Первые байты файла достаточно для тега MetaDataObject с version. */
const CONFIG_XML_HEAD_BYTES = 65536;

/** Без префикса или с префиксом (например после сторонней сериализации). */
const META_DATA_OBJECT_VERSION_RE = /<(?:[\w.-]+:)?MetaDataObject\b[^>]*\bversion\s*=\s*"([^"]+)"/;

/**
 * Преобразует значение атрибута {@code version} у {@code MetaDataObject} в имя enum md-sparrow (флаг {@code -v}).
 * Согласовано с {@link io.github.yellowhammer.designerxml.SchemaVersion#metadataObjectVersionAttribute} в Java.
 *
 * @example "2.20" → "V2_20", "2.21" → "V2_21"
 */
export function designerXmlVersionToMdSparrowFlag(versionAttr: string): string {
	const v = versionAttr.trim();
	if (!/^\d+(?:\.\d+)*$/.test(v)) {
		throw new Error(`Некорректное значение version у MetaDataObject: "${versionAttr}"`);
	}
	return `V${v.replaceAll('.', '_')}`;
}

/**
 * Читает атрибут version у корневого MetaDataObject из Configuration.xml (без полного парсинга XML).
 */
export async function readConfigurationXmlMetaDataVersion(configurationXmlPath: string): Promise<string> {
	const fs = await import('node:fs/promises');
	const fh = await fs.open(configurationXmlPath, 'r');
	try {
		const buf = Buffer.alloc(CONFIG_XML_HEAD_BYTES);
		const { bytesRead } = await fh.read(buf, 0, CONFIG_XML_HEAD_BYTES, 0);
		const head = buf.subarray(0, bytesRead).toString('utf8');
		const m = head.match(META_DATA_OBJECT_VERSION_RE);
		if (!m) {
			throw new Error(
				'В начале Configuration.xml не найден атрибут version у элемента MetaDataObject'
			);
		}
		return m[1].trim();
	} finally {
		await fh.close();
	}
}

/**
 * Значение для передачи в md-sparrow как {@code -v &lt;flag&gt;}.
 */
export async function mdSparrowSchemaFlagFromConfigurationXml(
	configurationXmlPath: string
): Promise<string> {
	const ver = await readConfigurationXmlMetaDataVersion(configurationXmlPath);
	return designerXmlVersionToMdSparrowFlag(ver);
}
