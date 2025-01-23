import fs from 'node:fs';
import bs58 from 'bs58'
import { canonicalize } from 'json-canonicalize';
import { config } from './config';
import { nanoid } from 'nanoid';
import { sha256 } from 'multiformats/hashes/sha2'
import { resolveDIDFromLog } from './method';
import type { CreateDIDInterface, DataIntegrityProof, DIDDoc, DIDLog, VerificationMethod, WitnessProofFileEntry } from './interfaces';
import { createBuffer, bufferToString } from './utils/buffer';
import { join } from 'path';

export const readLogFromDisk = (path: string): DIDLog => {
  return readLogFromString(fs.readFileSync(path, 'utf8'));
}

export const readLogFromString = (str: string): DIDLog => {
  return str.trim().split('\n').map(l => JSON.parse(l));
}

export const writeLogToDisk = (path: string, log: DIDLog) => {
  try {
    // Write first entry
    fs.writeFileSync(path, JSON.stringify(log[0]) + '\n');
    
    // Append remaining entries
    for (let i = 1; i < log.length; i++) {
      fs.appendFileSync(path, JSON.stringify(log[i]) + '\n');
    }
  } catch (error) {
    console.error('Error writing log to disk:', error);
    throw error;
  }
}

export const writeVerificationMethodToEnv = (verificationMethod: VerificationMethod) => {
  const envFilePath = process.cwd() + '/.env';
  
  const vmData = {
    id: verificationMethod.id,
    type: verificationMethod.type,
    controller: verificationMethod.controller || '',
    publicKeyMultibase: verificationMethod.publicKeyMultibase,
    secretKeyMultibase: verificationMethod.secretKeyMultibase || ''
  };

  try {
    // Read existing .env content
    let envContent = '';
    let existingData: any[] = [];
    
    if (fs.existsSync(envFilePath)) {
      envContent = fs.readFileSync(envFilePath, 'utf8');
      const match = envContent.match(/DID_VERIFICATION_METHODS=(.*)/);
      if (match && match[1]) {
        const decodedData = bufferToString(createBuffer(match[1], 'base64'));
        existingData = JSON.parse(decodedData);
        
        // Check if verification method with same ID already exists
        const existingIndex = existingData.findIndex(vm => vm.id === vmData.id);
        if (existingIndex !== -1) {
          // Update existing verification method
          existingData[existingIndex] = vmData;
        } else {
          // Add new verification method
          existingData.push(vmData);
        }
      } else {
        // No existing verification methods, create new array
        existingData = [vmData];
      }
    } else {
      // No .env file exists, create new array
      existingData = [vmData];
    }
    
    const jsonData = JSON.stringify(existingData);
    const encodedData = bufferToString(createBuffer(jsonData), 'base64');
    
    // If DID_VERIFICATION_METHODS already exists, replace it
    if (envContent.includes('DID_VERIFICATION_METHODS=')) {
      envContent = envContent.replace(/DID_VERIFICATION_METHODS=.*\n?/, `DID_VERIFICATION_METHODS=${encodedData}\n`);
    } else {
      // Otherwise append it
      envContent += `DID_VERIFICATION_METHODS=${encodedData}\n`;
    }

    fs.writeFileSync(envFilePath, envContent.trim() + '\n');
    console.log('Verification method written to .env file successfully.');
  } catch (error) {
    console.error('Error writing verification method to .env file:', error);
  }
};

export const clone = (input: any) => JSON.parse(JSON.stringify(input));

export const getBaseUrl = (id: string) => {
  const parts = id.split(':');
  if (!id.startsWith('did:webvh:') || parts.length < 4) {
    throw new Error(`${id} is not a valid did:webvh identifier`);
  }
  
  let domain = parts.slice(3).join('/');
  domain = domain.replace(/%2F/g, '/');
  domain = domain.replace(/%3A/g, ':');
  const protocol = domain.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${domain}`;
}

export const getFileUrl = (id: string) => {
  const baseUrl = getBaseUrl(id);
  const url = new URL(baseUrl);
  if (url.pathname !== '/') {
    return `${baseUrl}/did.jsonl`;
  }
  return `${baseUrl}/.well-known/did.jsonl`;
}

export async function fetchLogFromIdentifier(identifier: string, controlled: boolean = false): Promise<DIDLog> {
  try {
    if (controlled) {
      const didParts = identifier.split(':');
      const fileIdentifier = didParts.slice(4).join(':');
      const logPath = `./src/routes/${fileIdentifier || '.well-known'}/did.jsonl`;
      
      try {
        const text = (await Bun.file(logPath).text()).trim();
        if (!text) {
          return [];
        }
        return text.split('\n').map(line => JSON.parse(line));
      } catch (error) {
        throw new Error(`Error reading local DID log: ${error}`);
      }
    }

    const url = getFileUrl(identifier);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const text = (await response.text()).trim();
    if (!text) {
      throw new Error(`DID log not found for ${identifier}`);
    }
    return text.split('\n').map(line => JSON.parse(line));
  } catch (error) {
    console.error('Error fetching DID log:', error);
    throw error;
  }
}

export const createDate = (created?: Date | string) => new Date(created ?? Date.now()).toISOString().slice(0,-5)+'Z';

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const createSCID = async (logEntryHash: string): Promise<string> => {
  return logEntryHash;
}

export const deriveHash = async (input: any): Promise<string> => {
  const data = canonicalize(input);
  const hash = await sha256.digest(new TextEncoder().encode(data));
  return bs58.encode(hash.bytes)
}

export const deriveNextKeyHash = async (input: string): Promise<string> => {
  const hash = await sha256.digest(new TextEncoder().encode(input));
  return bs58.encode(hash.bytes);
}

export const createDIDDoc = async (options: CreateDIDInterface): Promise<{doc: DIDDoc}> => {
  const {controller} = options;
  const {all} = normalizeVMs(options.verificationMethods, controller);
  return {
    doc: {
      "@context": [
        "https://www.w3.org/ns/did/v1",
        "https://w3id.org/security/multikey/v1"
      ],
      id: controller,
      controller,
      ...all
    }
  };
}

export const createVMID = (vm: VerificationMethod, did: string | null) => {
  return `${did ?? ''}#${vm.publicKeyMultibase?.slice(-8) || nanoid(8)}`
}

export const normalizeVMs = (verificationMethod: VerificationMethod[] | undefined, did: string | null = null) => {
  if (!verificationMethod) {
    return {};
  }
  const all: any = {};
  const authentication = verificationMethod
    ?.filter(vm => vm.purpose === 'authentication').map(vm => createVMID(vm, did))
  if (authentication && authentication?.length > 0) {
    all.authentication = authentication;
  }
  const assertionMethod = verificationMethod
    ?.filter(vm => vm.purpose === 'assertionMethod').map(vm => createVMID(vm, did))
  if (assertionMethod && assertionMethod?.length > 0) {
    all.assertionMethod = assertionMethod;
  }
  const keyAgreement = verificationMethod
    ?.filter(vm => vm.purpose === 'keyAgreement').map(vm => createVMID(vm, did));
  if (keyAgreement && keyAgreement?.length > 0) {
    all.keyAgreement = keyAgreement;
  }
  const capabilityDelegation = verificationMethod
    ?.filter(vm => vm.purpose === 'capabilityDelegation').map(vm => createVMID(vm, did));
  if (capabilityDelegation && capabilityDelegation?.length > 0) {
    all.capabilityDelegation = capabilityDelegation;
  }
  const capabilityInvocation = verificationMethod
  ?.filter(vm => vm.purpose === 'capabilityInvocation').map(vm => createVMID(vm, did));
  if (capabilityInvocation && capabilityInvocation?.length > 0) {
    all.capabilityInvocation = capabilityInvocation;
  }
  if(verificationMethod && verificationMethod.length > 0) {
    all.verificationMethod = verificationMethod?.map(vm => ({
      id: createVMID(vm, did),
      ...(did ? {controller: vm.controller ?? did} : {}),
      type: 'Multikey',
      publicKeyMultibase: vm.publicKeyMultibase
    }))
  }
  return {all};
}

export const resolveVM = async (vm: string) => {
  try {
    if (vm.startsWith('did:key:')) {
      return {publicKeyMultibase: vm.split('did:key:')[1].split('#')[0]}
    }
    else if (vm.startsWith('did:webvh:')) {
      const url = getFileUrl(vm.split('#')[0]);
      const didLog = await (await fetch(url)).text();
      const logEntries: DIDLog = didLog.trim().split('\n').map(l => JSON.parse(l));
      const {doc} = await resolveDIDFromLog(logEntries, {verificationMethod: vm});
      return findVerificationMethod(doc, vm);
    }
    throw new Error(`Verification method ${vm} not found`);
  } catch (e) {
    throw new Error(`Error resolving VM ${vm}`)
  }
}

export const findVerificationMethod = (doc: any, vmId: string): VerificationMethod | null => {
  // Check in the verificationMethod array
  if (doc.verificationMethod && doc.verificationMethod.some((vm: any) => vm.id === vmId)) {
    return doc.verificationMethod.find((vm: any) => vm.id === vmId);
  }

  // Check in other verification method relationship arrays
  const vmRelationships = ['authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation'];
  for (const relationship of vmRelationships) {
    if (doc[relationship]) {
      if (doc[relationship].some((item: any) => item.id === vmId)) {
        return doc[relationship].find((item: any) => item.id === vmId);
      }
    }
  }

  return null;
}

export async function getActiveDIDs(): Promise<string[]> {
  const activeDIDs: string[] = [];
  
  try {
    for (const vm of config.getVerificationMethods()) {
      const did = vm.controller || vm.id.split('#')[0];
      activeDIDs.push(did);
    }
  } catch (error) {
    console.error('Error processing verification methods:', error);
  }
  
  return activeDIDs;
}

export async function fetchWitnessProofs(did: string): Promise<WitnessProofFileEntry[]> {
  try {
    const url = getFileUrl(did).replace('did.jsonl', 'did-witness.json');
    
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching witness proofs:', error);
    return [];
  }
}