interface DIDResolutionMeta {
  versionId: string;
  created: string;
  updated: string;
  previousLogEntryHash?: string;
  updateKeys: string[];
  scid: string;
  prerotation: boolean;
  portable: boolean;
  nextKeyHashes: string[];
  deactivated: boolean;
  witness?: WitnessParameter | undefined | null;
}

interface DIDDoc {
  "@context"?: string | string[] | object | object[];
  id?: string;
  controller?: string | string[];
  alsoKnownAs?: string[];
  authentication?: string[];
  assertionMethod?: string[];
  keyAgreement?: string[];
  capabilityInvocation?: string[];
  capabilityDelegation?: string[];
  verificationMethod?: VerificationMethod[];
  service?: ServiceEndpoint[];
}

// Remove the DIDOperation interface as it's no longer needed
// interface DIDOperation {
//   op: string;
//   path: string;
//   value: any;
// }

interface DataIntegrityProof {
  id?: string;
  type: string;
  cryptosuite: string;
  verificationMethod: string;
  created: string;
  proofValue: string;
  proofPurpose: string;
}

interface WitnessParameter {
  threshold: number;
  witnesses: WitnessEntry[];
}

interface WitnessEntry {
  id: string;  // did:key DID
  weight: number;
}

interface WitnessProofFile {
  versionId: string;
  proof: DataIntegrityProof[];
}

interface DIDLogEntry {
  versionId: string;
  versionTime: string;
  parameters: {
    method?: string;
    scid?: string;
    updateKeys?: string[];
    prerotation?: boolean;
    nextKeyHashes?: string[];
    portable?: boolean;
    witness?: WitnessParameter | null;
    deactivated?: boolean;
  };
  state: DIDDoc;
  proof?: DataIntegrityProof[];
}

type DIDLog = DIDLogEntry[];

interface ServiceEndpoint {
  id?: string;
  type: string | string[];
  serviceEndpoint?: string | string[] | any;
}

interface VerificationMethod {
  id?: string;
  type: 'Multikey';
  purpose?: 'authentication' | 'assertionMethod' | 'keyAgreement' | 'capabilityInvocation' | 'capabilityDelegation';
  controller?: string;
  publicKeyJWK?: any;
  publicKeyMultibase?: string;
  secretKeyMultibase?: string;
  use?: string;
}

interface CreateDIDInterface {
  domain: string;
  updateKeys: string[];
  signer: (doc: any) => Promise<{proof: any}>;
  controller?: string;
  context?: string | string[];
  verificationMethods?: VerificationMethod[];
  created?: Date;
  prerotation?: boolean;
  nextKeyHashes?: string[];
  portable?: boolean;
  witness?: WitnessParameter | null;
}

interface SignDIDDocInterface {
  document: any;
  proof: any;
  verificationMethod: VerificationMethod
}

interface UpdateDIDInterface {
  log: DIDLog;
  signer: (doc: any) => Promise<{proof: any}>;
  updateKeys?: string[];
  context?: string[];
  controller?: string[];
  verificationMethods?: VerificationMethod[];
  services?: ServiceEndpoint[];
  alsoKnownAs?: string[];
  domain?: string;
  updated?: Date | string;
  deactivated?: boolean;
  prerotation?: boolean;
  nextKeyHashes?: string[];
  witness?: WitnessParameter | undefined | null;
  witnessProofs?: WitnessProofFile[];
}

interface DeactivateDIDInterface {
  log: DIDLog;
  signer: (doc: any) => Promise<{proof: any}>;
}

interface ResolutionOptions {
  versionNumber?: number;
  versionId?: string;
  versionTime?: Date;
  verificationMethod?: string;
  witnessProofs?: WitnessProofFile[];
}
