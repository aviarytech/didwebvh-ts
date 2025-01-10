import { Elysia } from 'elysia'
import { getLatestDIDDoc, getLogFileForBase, getLogFileForSCID, getWitnessProofFile } from './routes/did';
import { createWitnessProof } from './witness';

const app = new Elysia()
  .get('/health', 'ok')
  .get('/.well-known/did.jsonl', () => getLogFileForBase())
  .get('/.well-known/did-witness.json', () => getWitnessProofFile())
  .group('/:id', app => {
    return app
      .get('/did.jsonl', ({params}) => getLogFileForSCID({params: {scid: params.id}}))
      .get('/:version', ({params: {id, version}}) => {
        console.log(version)
      })
      .get('/versions', ({params: {id}}) => {
        console.log('versions')
      })
      .get('/', ({params}) => getLatestDIDDoc({params}))
    })

const port = process.env.PORT || 8000;

// Parse the DID_VERIFICATION_METHODS environment variable
const verificationMethods = JSON.parse(Buffer.from(process.env.DID_VERIFICATION_METHODS || 'W10=', 'base64').toString('utf8'));

// Function to get all active DIDs from verification methods
async function getActiveDIDs(): Promise<string[]> {
  const activeDIDs: string[] = [];
  
  try {
    // Get unique DIDs from verification methods
    for (const vm of verificationMethods) {
      const did = vm.controller || vm.id.split('#')[0];
      activeDIDs.push(did);
    }
  } catch (error) {
    console.error('Error processing verification methods:', error);
  }
  
  return activeDIDs;
}

// Log active DIDs when server starts
app.onStart(async () => {
  console.log('\n=== Active DIDs ===');
  const activeDIDs = await getActiveDIDs();
  
  if (activeDIDs.length === 0) {
    console.log('No active DIDs found');
  } else {
    activeDIDs.forEach(did => console.log(did));
  }
  console.log('=================\n');
});

console.log(`🔍 Resolver is running at http://localhost:${port}`);
app.listen(port);
