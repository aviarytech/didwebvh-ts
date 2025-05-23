import { Elysia } from 'elysia'
import { resolveDID, AbstractCrypto } from 'didwebvh-ts';
import type { DIDDoc, SigningInput, SigningOutput, Verifier } from 'didwebvh-ts/types';

import { verify as ed25519Verify } from '@stablelib/ed25519';

class ElysiaVerifier extends AbstractCrypto implements Verifier {
  constructor(public readonly verificationMethod: {
    id: string;
    controller: string;
    type: string;
    publicKeyMultibase: string;
    secretKeyMultibase: string;
  }) {
    super({ verificationMethod });
  }

  async sign(input: SigningInput): Promise<SigningOutput> {
    throw new Error('Not implemented');
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return ed25519Verify(publicKey, message, signature);
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

const getFile = async ({
  params: {path, file},
  isRemote = false,
  didDocument
}: {
  params: {path: string; file: string},
  isRemote?: boolean,
  didDocument?: DIDDoc
}) => {
  try {
    if (isRemote) {
      let serviceEndpoint;
      
      if (file === 'whois') {
        const whoisService = didDocument?.service?.find(
          (s: any) => s.id === '#whois'
        );
        
        if (whoisService?.serviceEndpoint) {
          serviceEndpoint = whoisService.serviceEndpoint;
        }
      } else {
        const filesService = didDocument?.service?.find(
          (s: any) => s.id === '#files'
        );
        
        if (filesService?.serviceEndpoint) {
          serviceEndpoint = filesService.serviceEndpoint;
        }
      }

      if (!serviceEndpoint) {
        const cleanDomain = path.replace('.well-known/', '');
        serviceEndpoint = `https://${cleanDomain}`;
        
        if (file === 'whois') {
          serviceEndpoint = `${serviceEndpoint}/whois.vp`;
        }
      }
      
      serviceEndpoint = serviceEndpoint.replace(/\/$/, '');
      const url = file === 'whois' ? serviceEndpoint : `${serviceEndpoint}/${file}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Error 404: Not Found');
        }
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }
      return response.text();
    }
    
    if (file === 'whois') {
      file = 'whois.vp';
    }
    
    const filePath = WELL_KNOWN_ALLOW_LIST.some(f => f === file) ? 
      `./src/routes/.well-known/${file}` : 
      path ? `./src/routes/${path}/${file}` : 
      `./src/routes/${file}`;
      
    return await Bun.file(filePath).text();
  } catch (e: unknown) {
    console.error(e);
    throw new Error(`Failed to resolve File: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const app = new Elysia()
  .get('/health', () => 'ok')
  .get('/resolve/:id', async ({ params, query }) => {
    try {
      const id = params.id;
      if (!id) {
        throw new Error('No id provided');
      }

      const [didPart, ...pathParts] = id.split('/');
      if (pathParts.length === 0) {
        const options = {
          versionNumber: query?.versionNumber ? parseInt(query.versionNumber as string) : undefined,
          versionId: query?.versionId as string,
          versionTime: query?.versionTime ? new Date(query.versionTime as string) : undefined,
          verificationMethod: query?.verificationMethod as string,
          verifier: elysiaVerifier
        };
        
        console.log(`Resolving DID ${didPart}`);
        return await resolveDID(didPart, options);
      }
      
      const {did, doc, controlled} = await resolveDID(didPart, { verifier: elysiaVerifier });
      
      const didParts = did.split(':');
      const domain = didParts[didParts.length - 1];
      const fileIdentifier = didParts[didParts.length - 2];
      
      const fileContent = await getFile({
        params: {
          path: !controlled ? domain : fileIdentifier,
          file: pathParts.join('/')
        },
        isRemote: !controlled,
        didDocument: doc
      });
      
      return fileContent;
    } catch (error: unknown) {
      return {
        error: 'Resolution failed',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  })
  .listen(3010);

console.log(`🦊 Elysia resolver is running at ${app.server?.hostname}:${app.server?.port}`);