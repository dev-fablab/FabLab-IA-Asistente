export { ensureMastraReady, getMastra } from './mastra';
export { enableRlsOnMastraTables, MASTRA_SCHEMA } from './storage';
export { fabLabAgent } from './agents/fablab-agent';
export { buildInstructions, type AgentChannel } from './agents/fablab-instructions';
export { ConfigurationError } from './env';
export {
  GET_CONTACT_INFO_TOOL_ID,
  getContactInfo,
  type GetContactInfoResult,
} from './tools/get-contact-info';
export {
  GET_DOCUMENT_LINK_TOOL_ID,
  getDocumentLink,
  type GetDocumentLinkResult,
} from './tools/get-document-link';
export {
  SEARCH_DOCUMENTS_TOOL_ID,
  searchDocuments,
  type SearchDocumentsResult,
} from './tools/search-documents';
