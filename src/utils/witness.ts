import { base58btc } from "multiformats/bases/base58";
import { canonicalize } from "json-canonicalize";
import { createHash } from "./crypto";
import { concatBuffers } from "./buffer";
import type { DataIntegrityProof, WitnessProofFileEntry } from "../interfaces";
import { config } from '../config';

export async function createWitnessProof(
  signer: (doc: any) => Promise<{proof: any}>,
  versionId: string
): Promise<DataIntegrityProof> {
  // Create the proof without value first
  const proof = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: new Date().toISOString(),
    proofPurpose: "authentication"
  };

  // Sign the data using the provided signer
  const signedData = await signer({versionId});
  
  // Return complete proof with signature
  return {
    ...proof,
    ...signedData.proof
  };
}
