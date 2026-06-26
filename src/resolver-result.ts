import type { DIDDocumentMetadata, DIDResolutionMetadata, DIDResolutionResult } from 'did-resolver';
import type { DIDDoc, DIDResolutionMeta, DidResolutionError, ProblemDetails } from './interfaces';

export interface WebvhResolutionMetadata extends DIDResolutionMetadata {
  problemDetails?: ProblemDetails;
  controlled?: boolean;
}

export interface WebvhDocumentMetadata extends DIDDocumentMetadata {
  scid?: string;
  updateKeys?: string[];
  nextKeyHashes?: string[];
  prerotation?: boolean;
  portable?: boolean;
  witness?: DIDResolutionMeta['witness'];
  watchers?: string[] | null;
  previousLogEntryHash?: string;
  latestVersionId?: string;
}

const CONTENT_TYPE = 'application/did+ld+json';

export function validateSingleVersionSelector(options: {
  versionId?: string;
  versionTime?: Date;
  versionNumber?: number;
}): { code: 'invalidDid'; detail: string } | null {
  const count =
    (options.versionId !== undefined ? 1 : 0) +
    (options.versionTime !== undefined ? 1 : 0) +
    (options.versionNumber !== undefined ? 1 : 0);
  if (count > 1) {
    return {
      code: 'invalidDid',
      detail: 'At most one of versionId, versionTime, versionNumber may be supplied; they are mutually exclusive.',
    };
  }
  return null;
}

export function mapErrorToCode(error: unknown): DidResolutionError {
  const message = error instanceof Error ? error.message : String(error);
  // Only a genuine failure to fetch the DID log (or a DID-URL resource) is
  // `notFound`. Match the library's own absence messages rather than scanning
  // for "404"/"not found" anywhere in the text: validation errors can embed
  // attacker-controlled log data (e.g. a tampered versionId of "404", or
  // "Invalid update key … Not found in nextKeyHashes …"), and those are
  // invalid documents, not missing ones.
  if (/HTTP error! status: 404\b/.test(message) || /DID log not found/i.test(message)) {
    return 'notFound';
  }
  // Any non-404 HTTP error status (4xx/5xx) or network/transport failure is a
  // resolver-side internal error, not an invalid document: a valid DID served
  // from an unauthorized, gone, rate-limited, or failing endpoint must not be
  // reported as a document-validation failure. (404 is handled above as
  // notFound.) Everything else that reaches here is a validation failure.
  if (
    /HTTP error! status: [45]\d\d\b/.test(message) ||
    /fetch failed/i.test(message) ||
    /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b/.test(message) ||
    /network (error|request failed)/i.test(message)
  ) {
    return 'internalError';
  }
  return 'invalidDid';
}

/** RFC9457-style `type`/`title` for each standard error code. */
const PROBLEM_DETAILS_BY_CODE: Record<DidResolutionError, { type: string; title: string }> = {
  notFound: {
    type: 'https://w3id.org/security#NOT_FOUND',
    title: 'The DID Log or resource was not found.',
  },
  invalidDid: {
    type: 'https://w3id.org/security#INVALID_CONTROLLED_IDENTIFIER_DOCUMENT_ID',
    title: 'The resolved DID is invalid.',
  },
  internalError: {
    type: 'https://www.w3.org/ns/did#INTERNAL_ERROR',
    title: 'An unexpected error occurred during resolution.',
  },
};

export function toErrorResult(
  code: DidResolutionError,
  detail: string,
  extras: { controlled?: boolean } = {}
): DIDResolutionResult {
  const { type, title } = PROBLEM_DETAILS_BY_CODE[code];
  const didResolutionMetadata: WebvhResolutionMetadata = {
    error: code,
    message: detail,
    problemDetails: { type, title, detail },
  };
  if (extras.controlled !== undefined) {
    didResolutionMetadata.controlled = extras.controlled;
  }
  return { didResolutionMetadata, didDocument: null, didDocumentMetadata: {} };
}

export function toResolutionResult(
  core: { did: string; doc: DIDDoc | null; meta: DIDResolutionMeta },
  extras: { controlled?: boolean } = {}
): DIDResolutionResult {
  const { meta } = core;
  // Split meta into the standard documentMetadata + the resolutionMetadata extras.
  const { error, problemDetails, ...documentMeta } = meta;
  const didDocumentMetadata: WebvhDocumentMetadata = { ...documentMeta };

  if (error) {
    const code: DidResolutionError = error;
    const didResolutionMetadata: WebvhResolutionMetadata = { error: code };
    if (problemDetails) {
      didResolutionMetadata.problemDetails = problemDetails;
      didResolutionMetadata.message = problemDetails.detail;
    }
    if (extras.controlled !== undefined) {
      didResolutionMetadata.controlled = extras.controlled;
    }
    // Preserve the resolved document when the core produced one. A valid
    // earlier version can be returned alongside a warning-level error (e.g. an
    // explicit version selector that resolves cleanly while a later log entry
    // fails witness verification); dropping it would hide a legitimate result.
    return {
      didResolutionMetadata,
      didDocument: (core.doc as DIDResolutionResult['didDocument']) ?? null,
      didDocumentMetadata,
    };
  }

  const didResolutionMetadata: WebvhResolutionMetadata = { contentType: CONTENT_TYPE };
  if (extras.controlled !== undefined) {
    didResolutionMetadata.controlled = extras.controlled;
  }
  return {
    didResolutionMetadata,
    didDocument: (core.doc as DIDResolutionResult['didDocument']) ?? null,
    didDocumentMetadata,
  };
}
