export { AbstractCrypto, createDocumentSigner, createProof, createSigner, prepareDataForSigning } from './cryptography';
export * from './interfaces';
export { createDID, deactivateDID, resolveDID, resolveDIDFromLog, updateDID } from './method';
export type { GetResolverConfig } from './resolver';
export { getResolver } from './resolver';
export type { WebvhDocumentMetadata, WebvhResolutionMetadata } from './resolver-result';
export { deriveNextKeyHash, generateParallelDidWeb, parseDidKeyDid, parseDidKeyVerificationMethod } from './utils';
export { MultibaseEncoding, multibaseDecode, multibaseEncode } from './utils/multiformats';
export {
  createWitnessProof,
  signWitnessProofEntries,
  signWitnessProofEntry,
} from './witness';
