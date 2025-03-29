import { getBaseUrl } from './utils';
import type { ResourceResolutionOptions, ResourceResolutionResult, DIDDoc } from './interfaces';

const WELL_KNOWN_ALLOW_LIST = ['did.jsonl'];

export const getResource = async (options: ResourceResolutionOptions): Promise<ResourceResolutionResult> => {
  let { path, file, isRemote = false, didDocument } = options;

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
      
      console.log('Fetching resource:', {
        serviceEndpoint,
        file,
        url,
        isRemote
      });
      
      const response = await fetch(url);
      if (!response.ok) {
        console.error('Resource fetch failed:', {
          status: response.status,
          statusText: response.statusText,
          url
        });
        if (response.status === 404) {
          throw new Error('Error 404: Not Found');
        }
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      return {
        content: await response.text(),
        contentType: response.headers.get('content-type') || undefined
      };
    }
    
    if (file === 'whois') {
      file = 'whois.vp';
    }
    
    const filePath = WELL_KNOWN_ALLOW_LIST.some(f => f === file) ? 
      `./src/routes/.well-known/${file}` : 
      path ? `./src/routes/${path}/${file}` : 
      `./src/routes/${file}`;
      
    console.log('Reading local file:', filePath);
    const content = await Bun.file(filePath).text();
    return { content };
  } catch (e: unknown) {
    console.error('Resource resolution error:', e);
    throw new Error(`Failed to resolve Resource: ${e instanceof Error ? e.message : String(e)}`);
  }
}; 