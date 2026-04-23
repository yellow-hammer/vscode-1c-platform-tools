/**
 * Минимальная декларация для плагина cytoscape-elk без официальных типов.
 *
 * @module webviews/metadataErCanvas/cytoscape-elk
 */

declare module 'cytoscape-elk' {
	import type { Ext } from 'cytoscape';
	const ext: Ext;
	export default ext;
}
