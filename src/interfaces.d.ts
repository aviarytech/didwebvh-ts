interface DIDDoc {
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

interface DIDOperation {
  op: string;
  path: string;
  value: any;
}

type DIDLogEntry = [
  logEntryHash: string,
  versionId: number,
  timestamp: string,
  params: {method?: string, scid?: string},
  data: {value: any} | {path: DIDOperation[]},
  proof?: any
];
type DIDLog = DIDLogEntry[];

interface ServiceEndpoint {
  id?: string;
  type: string | string[];
  serviceEndpoint?: string | string[] | any;
}

interface VerificationMethod {
  id?: string;
  type: 'authentication' | 'assertionMethod' | 'keyAgreement' | 'capabilityInvocation' | 'capabilityDelegation';
  controller?: string;
  publicKeyJWK?: any;
  publicKeyMultibase?: string;
  secretKeyMultibase?: string;
  use?: string;
}

interface CreateDIDInterface {
  domain: string;
  controller?: string;
  context?: string | string[];
  verificationMethods?: VerificationMethod[];
  created?: Date;
  prerotation?: boolean;
}

interface SignDIDDocInterface {
  document: any;
  proof: any;
  verificationMethod: VerificationMethod
}

interface UpdateDIDInterface {
  log: DIDLog;
  authKey: VerificationMethod;
  context?: string[];
  controller?: string[];
  verificationMethods?: VerificationMethod[];
  services?: ServiceEndpoint[];
  alsoKnownAs?: string[];
  domain?: string;
  updated?: Date;
  prerotation?: boolean;
  deactivated?: boolean;
}

interface DeactivateDIDInterface {
  log: DIDLog;
  authKey: VerificationMethod;
}
