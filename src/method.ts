import { clone, createDate, createDIDDoc, createSCID, deriveHash, fetchLogFromIdentifier, findVerificationMethod, getActiveDIDs, getBaseUrl, normalizeVMs } from "./utils";
import { BASE_CONTEXT, METHOD, PLACEHOLDER, PROTOCOL } from './constants';
import { documentStateIsValid, hashChainValid, newKeysAreInNextKeys, scidIsFromHash } from './assertions';
import type { CreateDIDInterface, DIDResolutionMeta, DIDLogEntry, DIDLog, UpdateDIDInterface, DeactivateDIDInterface, ResolutionOptions, WitnessProofFileEntry } from './interfaces';
import { verifyWitnessProofs, validateWitnessParameter, fetchWitnessProofs } from './witness';

export const createDID = async (options: CreateDIDInterface): Promise<{did: string, doc: any, meta: DIDResolutionMeta, log: DIDLog}> => {
  if (!options.updateKeys) {
    throw new Error('Update keys not supplied')
  }
  
  if (options.witness && options.witness.witnesses.length > 0) {
    validateWitnessParameter(options.witness);
  }
  
  const controller = `did:${METHOD}:${PLACEHOLDER}:${options.domain}`;
  const createdDate = createDate(options.created);
  let {doc} = await createDIDDoc({...options, controller});
  const params = {
    scid: PLACEHOLDER,
    updateKeys: options.updateKeys,
    portable: options.portable ?? false,
    nextKeyHashes: options.nextKeyHashes ?? [],
    ...(options.witness ? {
      witness: options.witness
    } : {}),
    deactivated: false
  };
  const initialLogEntry: DIDLogEntry = {
    versionId: PLACEHOLDER,
    versionTime: createdDate,
    parameters: {
      method: PROTOCOL,
      ...params
    },
    state: doc
  };
  const initialLogEntryHash = await deriveHash(initialLogEntry);
  params.scid = await createSCID(initialLogEntryHash);
  initialLogEntry.state = doc;
  const prelimEntry = JSON.parse(JSON.stringify(initialLogEntry).replaceAll(PLACEHOLDER, params.scid));
  const logEntryHash2 = await deriveHash(prelimEntry);
  prelimEntry.versionId = `1-${logEntryHash2}`;
  const signedDoc = await options.signer(prelimEntry);
  let allProofs = [signedDoc.proof];
  prelimEntry.proof = allProofs;

  const verified = await documentStateIsValid(
    {...prelimEntry, versionId: `1-${logEntryHash2}`, proof: prelimEntry.proof}, 
    params.updateKeys, 
    params.witness,
    true // skipWitnessVerification
  );
  if (!verified) {
    throw new Error(`version ${prelimEntry.versionId} is invalid.`)
  }

  return {
    did: prelimEntry.state.id!,
    doc: prelimEntry.state,
    meta: {
      versionId: prelimEntry.versionId,
      created: prelimEntry.versionTime,
      updated: prelimEntry.versionTime,
      prerotation: (params.nextKeyHashes?.length ?? 0) > 0,
      ...params
    },
    log: [
      prelimEntry
    ]
  }
}

export const resolveDID = async (did: string, options: {
  versionNumber?: number, 
  versionId?: string, 
  versionTime?: Date,
  verificationMethod?: string
} = {}): Promise<{did: string, doc: any, meta: DIDResolutionMeta, controlled: boolean}> => {
  const activeDIDs = await getActiveDIDs();
  const controlled = activeDIDs.includes(did);
  const log = await fetchLogFromIdentifier(did, controlled);
  
  if (log.length === 0) {
    throw new Error(`DID ${did} not found`);
  }

  return {
    ...(await resolveDIDFromLog(log, { ...options })), 
    controlled
  };
}

export const resolveDIDFromLog = async (log: DIDLog, options: ResolutionOptions = {}): Promise<{did: string, doc: any, meta: DIDResolutionMeta}> => {
  if (options.verificationMethod && (options.versionNumber || options.versionId)) {
    throw new Error("Cannot specify both verificationMethod and version number/id");
  }
  const resolutionLog = clone(log);
  const protocol = resolutionLog[0].parameters.method;
  if(protocol !== PROTOCOL) {
    throw new Error(`'${protocol}' protocol unknown.`);
  }
  let doc: any = {};
  let did = '';
  let meta: DIDResolutionMeta = {
    versionId: '',
    created: '',
    updated: '',
    previousLogEntryHash: '',
    scid: '',
    prerotation: false,
    portable: false,
    nextKeyHashes: [],
    deactivated: false,
    updateKeys: [],
    witness: undefined
  };
  let host = '';
  let i = 0;
  
  while (i < resolutionLog.length) {
    const { versionId, versionTime, parameters, state, proof } = resolutionLog[i];
    const [version, entryHash] = versionId.split('-');
    if (parseInt(version) !== i + 1) {
      throw new Error(`version '${version}' in log doesn't match expected '${i + 1}'.`);
    }
    meta.versionId = versionId;
    if (versionTime) {
      // TODO check timestamps make sense
    }
    meta.updated = versionTime;
    let newDoc = state;
    if (version === '1') {
      meta.created = versionTime;
      newDoc = state;
      host = newDoc.id.split(':').at(-1);
      meta.scid = parameters.scid;
      meta.portable = parameters.portable ?? meta.portable;
      meta.updateKeys = parameters.updateKeys;
      meta.nextKeyHashes = parameters.nextKeyHashes || [];
      meta.prerotation = meta.nextKeyHashes.length > 0;
      meta.witness = parameters.witness || meta.witness;
      meta.nextKeyHashes = parameters.nextKeyHashes ?? [];
      const logEntry = {
        versionId: PLACEHOLDER,
        versionTime: meta.created,
        parameters: JSON.parse(JSON.stringify(parameters).replaceAll(meta.scid, PLACEHOLDER)),
        state: JSON.parse(JSON.stringify(newDoc).replaceAll(meta.scid, PLACEHOLDER))
      };
      const logEntryHash = await deriveHash(logEntry);
      meta.previousLogEntryHash = logEntryHash;
      if (!await scidIsFromHash(meta.scid, logEntryHash)) {
        throw new Error(`SCID '${meta.scid}' not derived from logEntryHash '${logEntryHash}'`);
      }
      const prelimEntry = JSON.parse(JSON.stringify(logEntry).replaceAll(PLACEHOLDER, meta.scid));
      const logEntryHash2 = await deriveHash(prelimEntry);
      const verified = await documentStateIsValid({...prelimEntry, versionId: `1-${logEntryHash2}`, proof}, meta.updateKeys, meta.witness);
      if (!verified) {
        throw new Error(`version ${meta.versionId} failed verification of the proof.`)
      }
    } else {
      // version number > 1
      const newHost = newDoc.id.split(':').at(-1);
      if (!meta.portable && newHost !== host) {
        throw new Error("Cannot move DID: portability is disabled");
      } else if (newHost !== host) {
        host = newHost;
      }
      const keys = meta.prerotation ? parameters.updateKeys : meta.updateKeys;
      const verified = await documentStateIsValid(resolutionLog[i], keys, meta.witness);
      if (!verified) {
        throw new Error(`version ${meta.versionId} failed verification of the proof.`)
      }

      if (!hashChainValid(`${i+1}-${entryHash}`, versionId)) {
        throw new Error(`Hash chain broken at '${meta.versionId}'`);
      }

      if (meta.prerotation) {
        await newKeysAreInNextKeys(
          parameters.updateKeys ?? [], 
          meta.nextKeyHashes ?? []
        );
      }

      if (parameters.updateKeys) {
        meta.updateKeys = parameters.updateKeys;
      }
      if (parameters.deactivated === true) {
        meta.deactivated = true;
      }
      if (parameters.nextKeyHashes) {
        meta.nextKeyHashes = parameters.nextKeyHashes;
        meta.prerotation = true;
      } else {
        meta.nextKeyHashes = [];
        meta.prerotation = false;
      }
      if (parameters.witnesses) {
        meta.witness = {
          witnesses: parameters.witnesses,
          threshold: parameters.witnessThreshold || parameters.witnesses.length
        };
      }
    }
    doc = clone(newDoc);
    did = doc.id;

    // Add default services if they don't exist
    doc.service = doc.service || [];
    const baseUrl = getBaseUrl(did);

    if (!doc.service.some((s: any) => s.id === '#files')) {
      doc.service.push({
        id: '#files',
        type: 'relativeRef',
        serviceEndpoint: baseUrl
      });
    }

    if (!doc.service.some((s: any) => s.id === '#whois')) {
      doc.service.push({
        "@context": "https://identity.foundation/linked-vp/contexts/v1",
        id: '#whois',
        type: 'LinkedVerifiablePresentation',
        serviceEndpoint: `${baseUrl}/whois.vp`
      });
    }

    if (options.verificationMethod && findVerificationMethod(doc, options.verificationMethod)) {
      return {did, doc, meta};
    }

    if (options.versionNumber === parseInt(version) || options.versionId === meta.versionId) {
      return {did, doc, meta};
    }
    if (options.versionTime && options.versionTime > new Date(meta.updated)) {
      if (resolutionLog[i+1] && options.versionTime < new Date(resolutionLog[i+1].versionTime)) {
        return {did, doc, meta};
      } else if(!resolutionLog[i+1]) {
        return {did, doc, meta};
      }
    }

    if (meta.witness && i === resolutionLog.length - 1) {
      if (!options.witnessProofs) {
        options.witnessProofs = await fetchWitnessProofs(did);
      }

      await verifyWitnessProofs(
        resolutionLog[i],
        options.witnessProofs!,
        meta.witness
      );
    }

    i++;
  }
  if (options.versionTime || options.versionId || options.verificationMethod) {
    throw new Error(`DID with options ${JSON.stringify(options)} not found`);
  }
  return {did, doc, meta};
}

export const updateDID = async (options: UpdateDIDInterface): Promise<{did: string, doc: any, meta: DIDResolutionMeta, log: DIDLog}> => {
  const {
    log, updateKeys, context, verificationMethods, services, alsoKnownAs,
    controller, domain, nextKeyHashes, witness} = options;
  let {did, doc, meta} = await resolveDIDFromLog(log);

  // Check for required nextKeyHashes if prerotation is enabled
  if (meta.nextKeyHashes.length > 0 && (!nextKeyHashes || nextKeyHashes.length === 0)) {
    throw new Error("nextKeyHashes are required if prerotation was previously enabled");
  }
  await newKeysAreInNextKeys(updateKeys ?? [], meta.nextKeyHashes);

  if (domain) {
    if (!meta.portable) {
      throw new Error(`Cannot move DID: portability is disabled`);
    }
    did = `did:${METHOD}:${domain}:${log[0].parameters.scid}`;
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
  const params = {
    ...(updateKeys ? {updateKeys} : {}),
    ...(nextKeyHashes ? {
      nextKeyHashes
    } : {}),
    ...(witness !== undefined ? {
      witness
    } : {})
  };
  const [currentVersion] = meta.versionId.split('-');
  const nextVersion = parseInt(currentVersion) + 1;
  meta.updated = createDate(options.updated);
  const logEntry: DIDLogEntry = {
    versionId: meta.versionId,
    versionTime: meta.updated,
    parameters: params,
    state: clone(newDoc)
  };
  const logEntryHash = await deriveHash(logEntry);
  logEntry.versionId = `${nextVersion}-${logEntryHash}`;
  const signedDoc = await options.signer(logEntry);
  logEntry.proof = [signedDoc.proof];
  const newMeta = {
    ...meta,
    versionId: logEntry.versionId,
    created: meta.created,
    updated: meta.updated,
    previousLogEntryHash: meta.previousLogEntryHash,
    prerotation: (nextKeyHashes?.length ?? 0) > 0,
    ...params
  };

  // Add witness parameter validation
  if (options.witness && options.witness.witnesses.length > 0) {
    validateWitnessParameter(options.witness);
  }

  return {
    did,
    doc: newDoc,
    meta: newMeta,
    log: [
      ...clone(log),
      clone(logEntry)
    ]
  };
}

export const deactivateDID = async (options: DeactivateDIDInterface): Promise<{did: string, doc: any, meta: DIDResolutionMeta, log: DIDLog}> => {
  const {log} = options;
  let {did, doc, meta} = await resolveDIDFromLog(log);
  const newDoc = {
    ...doc,
    authentication: [],
    assertionMethod: [],
    capabilityInvocation: [],
    capabilityDelegation: [],
    keyAgreement: [],
    verificationMethod: [],
  }
  const [currentVersion] = meta.versionId.split('-');
  const nextVersion = parseInt(currentVersion) + 1;
  meta.updated = createDate(meta.created);
  const logEntry: DIDLogEntry = {
    versionId: meta.versionId,
    versionTime: meta.updated,
    parameters: {updateKeys: options.updateKeys ?? [], nextKeyHashes: [], deactivated: true},
    state: clone(newDoc)
  };
  const logEntryHash = await deriveHash(logEntry);
  logEntry.versionId = `${nextVersion}-${logEntryHash}`;
  const signedDoc = await options.signer(logEntry);
  logEntry.proof = [signedDoc.proof];
  return {
    did,
    doc: newDoc,
    meta: {
      ...meta,
      versionId: logEntry.versionId,
      created: meta.created,
      updated: meta.updated,
      previousLogEntryHash: meta.previousLogEntryHash,
      deactivated: true
    },
    log: [
      ...clone(log),
      clone(logEntry)
    ]
  };
}
