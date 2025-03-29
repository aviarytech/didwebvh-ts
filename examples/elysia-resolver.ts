import { Elysia } from 'elysia'
import { resolveDID } from '../src/method';
import { getResource } from '../src/resource';
import type { Verifier, SigningInput, SigningOutput } from '../src/interfaces';
import { verify } from '@stablelib/ed25519';

class ElysiaVerifier implements Verifier {
  constructor(public readonly verificationMethod: {
    id: string;
    controller: string;
    type: string;
    publicKeyMultibase: string;
    secretKeyMultibase: string;
  }) {}

  async sign(input: SigningInput): Promise<SigningOutput> {
    throw new Error('Not implemented');
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return verify(publicKey, message, signature);
    } catch (error) {
      console.error('Ed25519 verification error:', error);
      return false;
    }
  }
}

const createElysiaVerifier = () => {
  return new ElysiaVerifier({
    id: 'did:example:123#key-1',
    controller: 'did:example:123',
    type: 'Ed25519VerificationKey2020',
    publicKeyMultibase: `z123`,
    secretKeyMultibase: `z123`
  });
};

const elysiaVerifier = createElysiaVerifier();

const WELL_KNOWN_ALLOW_LIST = ['did.jsonl'];

const handleResolve = async (id: string, query: any, pathSegments: string[] = []) => {
  try {
    const decodedId = decodeURIComponent(id);
    const [didPart] = decodedId.split('/');
    
    if (pathSegments.length === 0) {
      const options = {
        versionNumber: query?.versionNumber ? parseInt(query.versionNumber as string) : undefined,
        versionId: query?.versionId as string,
        versionTime: query?.versionTime ? new Date(query.versionTime as string) : undefined,
        verificationMethod: query?.verificationMethod as string,
        verifier: elysiaVerifier
      };
      
      return await resolveDID(didPart, options);
    }
    
    const {did, doc, controlled} = await resolveDID(didPart, { verifier: elysiaVerifier });
    
    // Get the service endpoint from the DID document
    const filesService = doc.service?.find((s: any) => s.id === '#files');
    const serviceEndpoint = filesService?.serviceEndpoint;
    
    if (!serviceEndpoint) {
      throw new Error('No files service endpoint found in DID document');
    }
    
    // For path parameter version, we need to decode each path segment
    // and filter out any segments that contain the DID
    const decodedPathSegments = pathSegments
      .map(segment => decodeURIComponent(segment))
      .filter(segment => !segment.includes(did));
    
    const resourcePath = decodedPathSegments.join('/');
    
    const result = await getResource({
      path: serviceEndpoint,
      file: resourcePath,
      isRemote: true,
      didDocument: doc
    });
    
    return result.content;
  } catch (error: unknown) {
    return {
      error: 'Resolution failed',
      details: error instanceof Error ? error.message : String(error)
    };
  }
};

const app = new Elysia()
  .get('/health', () => 'ok')
  .get('/resolve', async ({ query }) => {
    const id = query.id;
    if (!id) {
      return {
        error: 'Resolution failed',
        details: 'No id provided'
      };
    }
    const [didPart, ...pathParts] = id.split('/');
    return handleResolve(didPart, query, pathParts);
  })
  .get('/resolve/:id', async ({ params, query }) => {
    return handleResolve(params.id, query);
  })
  .get('/resolve/:id/*', async ({ params, query, path }) => {
    const pathSegments = path.split('/').slice(2); // Remove 'resolve' and the DID from the path
    return handleResolve(params.id, query, pathSegments);
  })
  .listen(3010);

console.log(`🦊 Elysia resolver is running at ${app.server?.hostname}:${app.server?.port}`);