import express from 'express';
import { resolveDID } from '../src/method';
import { getResource } from '../src/resource';
import type { DIDDoc, Verifier, SigningInput, SigningOutput } from '../src/interfaces';
import { verify } from '@stablelib/ed25519';

class ExpressVerifier implements Verifier {
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

const expressVerifier = new ExpressVerifier({
  id: 'did:example:123#key-1',
  controller: 'did:example:123',
  type: 'Ed25519VerificationKey2020',
  publicKeyMultibase: `z123`,
  secretKeyMultibase: `z123`
});

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;

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
    
    const result = await getResource({
      path: !controlled ? domain : fileIdentifier,
      file: pathParts.join('/'),
      isRemote: !controlled,
      didDocument: doc
    });
    
    res.send(result.content);
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
    const result = await getResource({
      path: pathParts.slice(0, -1).join('/'),
      file: pathParts[pathParts.length - 1],
      isRemote: false
    });
    res.send(result.content);
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
    const result = await getResource({
      path: '.well-known',
      file,
      isRemote: false
    });
    res.send(result.content);
  } catch (error) {
    res.status(404).json({
      error: 'Failed to resolve File',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(port, () => {
  console.log(`Express resolver is running on port ${port}`);
}); 