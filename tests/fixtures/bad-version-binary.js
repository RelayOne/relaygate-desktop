#!/usr/bin/env node
// Mock binary used by tests/gateway.test.ts to exercise GatewayController's
// "binary doesn't print expected version" rejection path. Emits a non-matching
// stderr string regardless of args.
process.stderr.write("not relaygate at all\n");
