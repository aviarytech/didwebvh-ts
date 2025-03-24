import express from 'express';
import { resolveDID } from 'didwebvh-ts';
import type { DIDDoc, SigningInput, SigningOutput, Verifier } from 'didwebvh-ts/types';

import { verify } from '@stablelib/ed25519';

class ExpressVerifier implements Verifier {
  private verificationMethodId: string;
  private publicKey: Uint8Array;

  constructor(keyId: string, verificationMethodId: string) {
    this.verificationMethodId = verificationMethodId;
  }

  async sign(input: SigningInput): Promise<SigningOutput> {
    throw new Error('Not implemented');
  }

  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    try {
      return verify(publicKey, message, signature);
    } catch (error) {
      return false;
    }
  }

  getVerificationMethodId(): string {
    return this.verificationMethodId;
  }

  getPublicKey(): Uint8Array {
    return this.publicKey;
  }
  
  getPublicKeyMultibase(): string {
    return `z${Buffer.from(this.publicKey).toString('base64')}`;
  }
}

const expressVerifier = new ExpressVerifier(
  'key-prod-1',
  'did:example:123#key-1'
);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;

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
    const filePath = WELL_KNOWN_ALLOW_LIST.some(f => f === file) ? `./src/routes/.well-known/${file}` : path ? `./src/routes/${path}/${file}` : `./src/routes/${file}`;
    return await Bun.file(filePath).text();
  } catch (e: unknown) {
    console.error(e);
    throw new Error(`Failed to resolve File: ${e instanceof Error ? e.message : String(e)}`);
  }
};

app.get('/health', (req, res) => {
  res.send('ok');
});

app.get('/resolve/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({
        error: 'No id provided'
      });
    }

    const [didPart, ...pathParts] = id.split('/');
    if (pathParts.length === 0) {
      const options = {
        versionNumber: req.query.versionNumber ? parseInt(req.query.versionNumber as string) : undefined,
        versionId: req.query.versionId as string,
        versionTime: req.query.versionTime ? new Date(req.query.versionTime as string) : undefined,
        verificationMethod: req.query.verificationMethod as string,
        verifier: expressVerifier
      };
      
      console.log(`Resolving DID ${didPart} with HSM verifier`);
      const result = await resolveDID(didPart, options);
      return res.json(result);
    }
    
    const {did, doc, controlled} = await resolveDID(didPart, { verifier: expressVerifier });
    
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
    
    res.send(fileContent);
  } catch (error: unknown) {
    console.error('Error resolving identifier:', error);
    res.status(400).json({
      error: 'Resolution failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get('/resolve/:id/*', async (req, res) => {
  try {
    const pathParts = req.params[0].split('/');
    const fileContent = await getFile({
      params: {
        path: pathParts.slice(0, -1).join('/'),
        file: pathParts[pathParts.length - 1]
      },
      isRemote: false
    });
    res.send(fileContent);
  } catch (error) {
    res.status(404).json({
      error: 'Failed to resolve File',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get('/.well-known/*', async (req, res) => {
  try {
    const file = req.params[0];
    const fileContent = await getFile({
      params: {
        path: '.well-known',
        file
      },
      isRemote: false
    });
    res.send(fileContent);
  } catch (error) {
    res.status(404).json({
      error: 'Failed to resolve File',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(port, () => {
  console.log(`🔍 Resolver is running at http://localhost:${port}`);
}); 