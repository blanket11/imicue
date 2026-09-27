import { catalogDefinition } from './definition.js';
const contentId = new URLSearchParams(location.search).get('content');
const content = contentId && Object.hasOwn(catalogDefinition.contents, contentId) ? catalogDefinition.contents[contentId] : undefined;
document.getElementById('catalog-guide-title').textContent = content?.title ?? '登録されていない案内です';
document.getElementById('catalog-guide-description').textContent = content?.description ?? '100件の閲覧デモから案内先を選び直してください。';
