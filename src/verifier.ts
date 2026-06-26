import { ed25519 } from '@noble/curves/ed25519.js';
import type { Verifier } from './interfaces';

/**
 * Built-in Ed25519 verifier. did:webvh proofs are always `eddsa-jcs-2022`
 * (Ed25519), so this lets `getResolver()` and the public resolvers work
 * with zero configuration. The public key handed in is the raw 32-byte
 * Ed25519 key (the multicodec `0xed01` prefix is stripped by the caller).
 */
export const defaultVerifier: Verifier = {
  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return ed25519.verify(signature, message, publicKey);
    } catch {
      return false;
    }
  },
};
