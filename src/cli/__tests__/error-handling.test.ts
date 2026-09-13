import fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { generateTestVerificationMethod } from '../../../test/utils.js';
import { CliError, handleCreate, handleDeactivate, handleResolve, handleUpdate, main } from '../index.js';

const TEST_DIR = join(process.cwd(), 'test', 'temp-cli-error-handling');
fs.mkdirSync(TEST_DIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('CLI error handling', () => {
  test('handlers reject missing required arguments without exiting', async () => {
    await expect(handleCreate([])).rejects.toMatchObject({
      name: 'CliError',
      message: 'Address is required for create command (use --address)',
    });
    await expect(handleResolve([])).rejects.toMatchObject({
      name: 'CliError',
      message: 'Either --did or --log is required for resolve command',
    });
    await expect(handleUpdate([])).rejects.toMatchObject({
      name: 'CliError',
      message: 'Log file is required for update command',
    });
    await expect(handleDeactivate([])).rejects.toMatchObject({
      name: 'CliError',
      message: 'Log file is required for deactivate command',
    });
  });

  test('main returns an exit code instead of terminating for an unknown command', async () => {
    const originalArgv = process.argv;
    process.argv = [...originalArgv.slice(0, 2), 'unknown'];

    try {
      await expect(main()).resolves.toBe(1);
    } finally {
      process.argv = originalArgv;
    }
  });

  test('main returns exit code 1 when verify-proofs reports an unsatisfied witness requirement', async () => {
    const logFile = join(TEST_DIR, 'verify-proofs-unsatisfied.jsonl');
    const witnessFile = join(TEST_DIR, 'verify-proofs-unsatisfied-witness.json');

    // A did:key witness identifier is enough to create a witnessed DID; no proof for it will be
    // supplied, so verifyWitnessProofs should report the requirement as unsatisfied rather than
    // throw.
    const witnessVm = await generateTestVerificationMethod();
    const witnessDid = `did:key:${witnessVm.publicKeyMultibase}`;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const created = await handleCreate(['--address', 'example.com', '--portable', '--witness', witnessDid]);
    fs.writeFileSync(logFile, `${created.log.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    fs.writeFileSync(witnessFile, '[]');

    const originalArgv = process.argv;
    process.argv = [...originalArgv.slice(0, 2), 'verify-proofs', '--log', logFile, '--witness-file', witnessFile];

    try {
      await expect(main()).resolves.toBe(1);
    } finally {
      process.argv = originalArgv;
      logSpy.mockRestore();
    }
  });

  test('CLI errors expose their exit code', () => {
    expect(new CliError('invalid command', 2).exitCode).toBe(2);
  });

  describe('unknown command output', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('main prints usage before reporting an unknown command', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalArgv = process.argv;
      process.argv = [...originalArgv.slice(0, 2), 'unknown'];

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
        expect(errorSpy).toHaveBeenCalledWith('Unknown command: unknown');
      } finally {
        process.argv = originalArgv;
      }
    });
  });

  describe('top-level error reporting', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('prints only the message for a CliError', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalArgv = process.argv;
      process.argv = [...originalArgv.slice(0, 2), 'resolve'];

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith('Either --did or --log is required for resolve command');
      } finally {
        process.argv = originalArgv;
      }
    });

    test('prints the stack trace for an unexpected, non-CliError error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalArgv = process.argv;
      process.argv = [
        ...originalArgv.slice(0, 2),
        'generate-witness-proof',
        '--version-id',
        '1-abc',
        '--witness-did',
        'did:key:invalid',
        '--witness-secret',
        'zBAD',
        '--output',
        '/tmp/cli-error-handling-test-witness.json',
      ];

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const loggedValue = errorSpy.mock.calls[0][0];
        expect(loggedValue).toEqual(expect.stringContaining('Error:'));
        expect(loggedValue).toEqual(expect.stringContaining(' at '));
      } finally {
        process.argv = originalArgv;
      }
    });
  });

  describe('resolve/update/deactivate surface the original CliError unwrapped', () => {
    test('handleResolve propagates the inner resolution CliError without re-wrapping', async () => {
      const logFile = join(TEST_DIR, 'bad-resolve.jsonl');
      fs.writeFileSync(logFile, `${JSON.stringify({ invalid: 'log' })}\n`);

      await expect(handleResolve(['--log', logFile])).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('Resolution error:'),
      });
      // Guards against the double-wrap regression: message must not contain the
      // outer "Error resolving DID:" prefix that would appear if re-wrapped.
      await expect(handleResolve(['--log', logFile])).rejects.not.toMatchObject({
        message: expect.stringContaining('Error resolving DID:'),
      });
    });

    test('handleResolve wraps unexpected non-CliError errors with context', async () => {
      const missingFile = join(TEST_DIR, 'does-not-exist.jsonl');

      await expect(handleResolve(['--log', missingFile])).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('Error resolving DID:'),
      });
    });

    test('handleUpdate wraps unexpected errors reading a missing log file', async () => {
      const missingFile = join(TEST_DIR, 'does-not-exist-update.jsonl');

      await expect(handleUpdate(['--log', missingFile])).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('Error updating DID:'),
      });
    });

    test('handleDeactivate wraps unexpected errors reading a missing log file', async () => {
      const missingFile = join(TEST_DIR, 'does-not-exist-deactivate.jsonl');

      await expect(handleDeactivate(['--log', missingFile])).rejects.toMatchObject({
        name: 'CliError',
        message: expect.stringContaining('Error deactivating DID:'),
      });
    });
  });

  describe('generate-witness-proof argument validation', () => {
    test('rejects when no --version-id is provided', async () => {
      const originalArgv = process.argv;
      process.argv = [
        ...originalArgv.slice(0, 2),
        'generate-witness-proof',
        '--witness-did',
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        '--witness-secret',
        'z1A',
        '--output',
        join(TEST_DIR, 'witness.json'),
      ];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('At least one --version-id is required');
      } finally {
        process.argv = originalArgv;
        errorSpy.mockRestore();
      }
    });

    test('rejects when --output is missing', async () => {
      const originalArgv = process.argv;
      process.argv = [
        ...originalArgv.slice(0, 2),
        'generate-witness-proof',
        '--version-id',
        '1-abc',
        '--witness-did',
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        '--witness-secret',
        'z1A',
      ];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Output file is required');
      } finally {
        process.argv = originalArgv;
        errorSpy.mockRestore();
      }
    });

    test('rejects when witness DIDs and secrets counts do not match', async () => {
      const originalArgv = process.argv;
      process.argv = [
        ...originalArgv.slice(0, 2),
        'generate-witness-proof',
        '--version-id',
        '1-abc',
        '--witness-did',
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        '--witness-did',
        'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        '--witness-secret',
        'z1A',
        '--output',
        join(TEST_DIR, 'witness.json'),
      ];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Must provide matching number of witness DIDs and secrets');
      } finally {
        process.argv = originalArgv;
        errorSpy.mockRestore();
      }
    });
  });

  describe('--add-vm argument validation', () => {
    test('rejects an invalid verification method type', async () => {
      const originalArgv = process.argv;
      process.argv = [
        ...originalArgv.slice(0, 2),
        'update',
        '--log',
        join(TEST_DIR, 'does-not-matter.jsonl'),
        '--add-vm',
        'not-a-real-type',
      ];
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const exitCode = await main();
        expect(exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalledWith('Invalid verification method type: not-a-real-type');
      } finally {
        process.argv = originalArgv;
        errorSpy.mockRestore();
      }
    });
  });

  describe('handleDeactivate environment failures', () => {
    test('wraps "no verification method found in environment" as a CliError', async () => {
      // writeVerificationMethodToEnv()/getVerificationMethodsFromEnv() both resolve to
      // `${process.cwd()}/.env`. Run this test from an isolated scratch directory instead of
      // touching the real repo .env, which e2e.test.ts also manipulates and could race with.
      const isolatedCwd = fs.mkdtempSync(join(TEST_DIR, 'env-isolation-'));
      const logFile = join(isolatedCwd, 'deactivate-no-env.jsonl');
      const originalCwd = process.cwd();
      const originalEnvVar = process.env.DID_VERIFICATION_METHODS;

      process.chdir(isolatedCwd);
      try {
        // Create a minimal DID via handleCreate without --output, so no env VM is persisted,
        // but capture the log for use with handleDeactivate against a clean environment.
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const created = await handleCreate(['--address', 'example.com', '--portable']);
        logSpy.mockRestore();
        fs.writeFileSync(logFile, `${created.log.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

        // Ensure the in-process env var is clear too, since getVerificationMethodsFromEnv()
        // prefers it over the (isolated, non-existent) on-disk .env fallback.
        delete process.env.DID_VERIFICATION_METHODS;

        await expect(handleDeactivate(['--log', logFile])).rejects.toMatchObject({
          name: 'CliError',
          message: expect.stringContaining('No verification method found in environment'),
        });
      } finally {
        process.chdir(originalCwd);
        if (originalEnvVar !== undefined) {
          process.env.DID_VERIFICATION_METHODS = originalEnvVar;
        } else {
          delete process.env.DID_VERIFICATION_METHODS;
        }
        fs.rmSync(isolatedCwd, { recursive: true, force: true });
      }
    });
  });
});
