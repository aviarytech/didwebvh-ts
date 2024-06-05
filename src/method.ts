import * as jsonpatch from 'fast-json-patch/index.mjs';
import { clone, createDate, createDIDDoc, createSCID, createVMID, deriveHash, normalizeVMs } from "./utils";
import { BASE_CONTEXT, METHOD, PLACEHOLDER, PROTOCOL } from './constants';
import { documentStateIsValid, newKeysAreValid } from './assertions';
import { signDocument } from './signing';


export const createDID = async (options: CreateDIDInterface): Promise<{did: string, doc: any, meta: any, log: DIDLog}> => {
  newKeysAreValid(options);
  const controller = `did:${METHOD}:${options.domain}:${PLACEHOLDER}`
  let {doc} = await createDIDDoc({...options, controller});
  const {logEntryHash: genesisDocHash} = await deriveHash(doc);
  const scid = await createSCID(genesisDocHash);
  doc = JSON.parse(JSON.stringify(doc).replaceAll(PLACEHOLDER, scid));
  const logEntry: DIDLogEntry = [
    scid,
    1,
    createDate(options.created),
    {method: PROTOCOL, scid},
    {value: doc}
  ]
  const {logEntryHash} = await deriveHash(logEntry);
  logEntry[0] = logEntryHash;
  let authKey = {...options.verificationMethods?.find(vm => vm.type === 'authentication')};
  if (!authKey) {
    throw new Error('Auth key not supplied')
  }
  authKey.id = createVMID({...authKey, type: 'authentication'}, doc.id!);
  const signedDoc = await signDocument(doc, {...authKey, type: 'authentication'}, logEntryHash);
  logEntry.push([signedDoc.proof]);
  return {
    did: doc.id!,
    doc,
    meta: {
      versionId: 1,
      created: logEntry[2],
      updated: logEntry[2]
    },
    log: [
      logEntry
    ]
  }
}

export const resolveDID = async (log: DIDLog, options: {versionId?: number, versionTime?: Date} = {}): Promise<{did: string, doc: any, meta: any}> => {
  const resolutionLog = clone(log);
  const protocol = resolutionLog[0][3].method;
  if(protocol !== PROTOCOL) {
    throw new Error(`'${protocol}' protocol unknown.`);
  }
  let versionId = 0;
  let doc: any = {};
  let did = '';
  let scid = '';
  let created = '';
  let updated = '';
  let previousLogEntryHash = '';
  let i = 0;
  let deactivated: boolean | null = null;
  let prerotation = false;
  let prerotationInitialized: number | null = null;
  let nextKeys: string[] = [];
  for (const entry of resolutionLog) {
    if (entry[1] !== versionId + 1) {
      throw new Error(`versionId '${entry[1]}' in log doesn't match expected '${versionId}'.`);
    }
    versionId = entry[1];
    if (entry[2]) {
      // TODO check timestamps make sense
    }
    updated = entry[2];

    // doc patches & proof
    let newDoc;
    if (versionId === 1) {
      created = entry[2];
      newDoc = entry[4].value;
      scid = entry[3].scid;
      const {logEntryHash} = await deriveHash(
        JSON.parse(JSON.stringify(newDoc).replaceAll(scid, PLACEHOLDER))
      );
      const derivedScid = await createSCID(logEntryHash);
      previousLogEntryHash = logEntryHash;
      if (scid !== derivedScid) {
        throw new Error(`SCID '${scid}' not derived from logEntryHash '${logEntryHash}' (scid ${derivedScid})`);
      }
      const authKey = newDoc.verificationMethod.find((vm: VerificationMethod) => vm.id === entry[5][0].verificationMethod);
      const verified = await documentStateIsValid(authKey, newDoc, entry[5], newDoc);
      if (!verified) {
        throw new Error(`version ${versionId} failed verification of the proof.`)
      }
      if (entry[3].prerotation) {
        prerotation = true;
        prerotationInitialized = 1;
        nextKeys += entry[3].nextKeys;
      }
    } else {
      // versionId > 1
      if (Object.keys(entry[4]).some((k: string) => k === 'value')) {
        newDoc = entry[4].value;
      } else {
        newDoc = jsonpatch.applyPatch(doc, entry[4].patch, false, false).newDocument;
      }
      const {logEntryHash} = await deriveHash([previousLogEntryHash, entry[1], entry[2], entry[3], entry[4]]);
      previousLogEntryHash = logEntryHash;
      if (logEntryHash !== entry[0]) {
        throw new Error(`Hash chain broken at '${versionId}'`);
      }
      const authKey = doc.verificationMethod.find((vm: VerificationMethod) => vm.id === entry[5][0].verificationMethod);
      if (!authKey) {
        throw new Error(`Auth key '${entry[5].verificationMethod}' not found in previous document`);
      }
      const verified = await documentStateIsValid(authKey, newDoc, entry[5], doc);
      if (!verified) {
        throw new Error(`version ${versionId} failed verification of the proof.`)
      }
      if (entry[3].deactivated) {
        deactivated = true;
      }
      if(prerotation) {
        newKeysAreValid(options)
      }
      if (entry[3].prerotation) {
        prerotation = true;
        prerotationInitialized = versionId;
        nextKeys.push(entry[3].nextKeys ?? [])
      }
    }
    doc = clone(newDoc);
    did = doc.id;
    if (options.versionId === versionId) {
      return {did, doc, meta: {versionId, created, updated, previousLogEntryHash, scid}}
    }
    if (options.versionTime && options.versionTime > new Date(updated)) {
      if (resolutionLog[i+1] && options.versionTime < new Date(resolutionLog[i+1][2])) {
        return {did, doc, meta: {versionId, created, updated, previousLogEntryHash, scid}}
      } else if(!resolutionLog[i+1]) {
        return {did, doc, meta: {versionId, created, updated, previousLogEntryHash, scid}}
      }
    }
    i++;
  }
  if (options.versionTime || options.versionId) {
    throw new Error(`DID with options ${JSON.stringify(options)} not found`);
  }
  return {did, doc, meta: {
    versionId, created, updated, previousLogEntryHash, scid,
    ...(deactivated ? {deactivated}: {}),
    prerotation,
    ...(prerotation ? {prerotationInitialized} : {})
  }}
}

export const updateDID = async (options: UpdateDIDInterface): Promise<{did: string, doc: any, meta: any, log: DIDLog}> => {
  const {log, authKey, context, verificationMethods, services, alsoKnownAs, controller, domain} = options;
  let {did, doc, meta} = await resolveDID(log);
  newKeysAreValid(options, meta);
  if (domain) {
    did = `did:${METHOD}:${domain}:${log[0][3].scid}`;
  }
  const {all} = normalizeVMs(verificationMethods, did);
  const newDoc = {
    ...(context ? {'@context': Array.from(new Set([...BASE_CONTEXT, ...context]))} : {'@context': BASE_CONTEXT}),
    id: did,
    ...(controller ? {controller: Array.from(new Set([did, ...controller]))} : {controller:[did]}),
    ...all,
    ...(services ? {service: services} : {}),
    ...(alsoKnownAs ? {alsoKnownAs} : {})
  }
  meta.versionId++;
  meta.updated = createDate(options.updated);
  const patch = jsonpatch.compare(doc, newDoc);
  const logEntry = [meta.previousLogEntryHash, meta.versionId, meta.updated, {}, {patch: clone(patch)}];
  const {logEntryHash} = await deriveHash(logEntry);
  if(!authKey) {
    throw new Error(`No auth key`);
  }
  authKey.id = authKey.id ?? createVMID({...authKey, type: 'authentication'}, doc.id);
  const signedDoc = await signDocument(newDoc, authKey, logEntryHash);
  return {
    did,
    doc: newDoc,
    meta: {
      versionId: meta.versionId,
      created: meta.created,
      updated: meta.updated,
      previousLogEntryHash: meta.previousLogEntryHash
    },
    log: [
      ...clone(log),
      [logEntryHash, meta.versionId, meta.updated, {}, {patch: clone(patch)}, [signedDoc.proof]]
    ]
  };
}

export const deactivateDID = async (options: DeactivateDIDInterface): Promise<{did: string, doc: any, meta: any, log: DIDLog}> => {
  const {log, authKey} = options;
  let {did, doc, meta} = await resolveDID(log);
  const newDoc = {
    ...doc,
    authentication: [],
    assertionMethod: [],
    capabilityInvocation: [],
    capabilityDelegation: [],
    keyAgreement: [],
    verificationMethod: [],
  }
  meta.versionId++;
  meta.updated = createDate(meta.created);
  const patch = jsonpatch.compare(doc, newDoc);
  const logEntry = [meta.previousLogEntryHash, meta.versionId, meta.updated, {deactivated: true}, {patch: clone(patch)}];
  const {logEntryHash} = await deriveHash(logEntry);
  if(!authKey) {
    throw new Error(`No auth key`);
  }
  authKey.id = authKey.id ?? createVMID({...authKey, type: 'authentication'}, doc.id);
  const signedDoc = await signDocument(newDoc, authKey, logEntryHash);
  return {
    did,
    doc: newDoc,
    meta: {
      versionId: meta.versionId,
      created: meta.created,
      updated: meta.updated,
      previousLogEntryHash: meta.previousLogEntryHash,
      deactivated: true
    },
    log: [
      ...clone(log),
      [logEntryHash, meta.versionId, meta.updated, {deactivated: true}, {patch: clone(patch)}, [signedDoc.proof]]
    ]
  };
}
